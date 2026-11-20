"""The policy/value network (same layers as src/bots/learn/model.ts), the shard loader and the exporter.

Shards are written by scripts/learn/shard.ts: 8-byte header length, a JSON header (name -> dtype, shape,
offset), then the arrays. Everything is loaded onto the GPU once; batches are gathered there.
"""
from __future__ import annotations

import base64
import glob
import json
import os
import struct

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Must match src/bots/learn/encode.ts and model.ts (checked against the shard shapes and by tests).
SLOTS, SLOT_F, BAGS = 18, 44, 8
E, SH, BAGD, H, OH = 16, 64, 16, 256, 128


def card_keys() -> list[str]:
    with open(os.path.join(ROOT, "data", "cards.manifest.json"), encoding="utf-8") as f:
        return sorted(json.load(f)["cards"].keys())


DTYPES = {"f2": np.float16, "f4": np.float32, "i1": np.int8, "i2": np.int16, "i4": np.int32, "u1": np.uint8}


def read_shard(path: str) -> dict[str, np.ndarray]:
    with open(path, "rb") as f:
        return parse_shard(f.read())


def parse_shard(raw: bytes | memoryview, start: int = 0) -> dict[str, np.ndarray]:
    """A shard's arrays from its bytes (a file, or a frame from gen.ts in batched mode), starting at `start`."""
    (n,) = struct.unpack_from("<Q", raw, start)
    header = json.loads(bytes(raw[start + 8 : start + 8 + n]))
    base = start + 8 + n
    out = {}
    for name, h in header.items():
        dt = np.dtype(DTYPES[h["dtype"]])
        count = int(np.prod(h["shape"])) if h["shape"] else 1
        out[name] = np.frombuffer(raw, dtype=dt, count=count, offset=base + h["offset"]).reshape(h["shape"])
    return out


class Data:
    """All rows of a set of shards, on the GPU. Option rows are flat; each row knows its slice."""

    def __init__(self, paths: list[str], device=DEVICE):
        parts = [read_shard(p) for p in paths]
        parts = [p for p in parts if p["slots"].shape[0] > 0]
        cat = lambda k: np.concatenate([p[k] for p in parts])
        # Option slices move when shards are joined, and game ids must stay unique per shard.
        starts, games, off, gid = [], [], 0, 0
        for p in parts:
            starts.append(p["optStart"].astype(np.int64) + off)
            off += p["optCard"].shape[0]
            g = p["game"].astype(np.int64)
            games.append(g + gid)
            gid += int(g.max()) + 1 if len(g) else 0
        self.n = sum(p["slots"].shape[0] for p in parts)
        t = lambda a, dt=None: torch.from_numpy(np.ascontiguousarray(a)).to(device) if dt is None else torch.from_numpy(np.ascontiguousarray(a)).to(device, dt)
        self.slots = t(cat("slots"))
        self.slot_cards = t(cat("slotCards"), torch.long)
        self.bags = t(cat("bags"))
        self.glob = t(cat("glob"))
        self.source = t(cat("source"), torch.long)
        self.opt_start = t(np.concatenate(starts))
        self.opt_count = t(cat("optCount"), torch.long)
        self.chosen = t(cat("chosen"), torch.long)
        self.logp = t(cat("logp"))
        self.value = t(cat("value"))
        # Rows the recorded bot searched (look-ahead); shards written before the flag existed have none.
        self.searched = t(np.concatenate([p["searched"] if "searched" in p else np.zeros(p["slots"].shape[0], np.uint8) for p in parts]), torch.bool)
        self.game = t(np.concatenate(games))
        self.player = t(cat("player"), torch.long)
        self.outcome = t(cat("outcome"))
        self.opt_x = t(cat("optX"))
        self.opt_card = t(cat("optCard"), torch.long)
        self.opt_slot = t(cat("optSlot"), torch.long)
        # The deciding network's logits per option (soft targets for imitation), in shards that have them.
        has_soft = all("soft" in p for p in parts)
        self.soft = t(cat("soft"), torch.bool) if has_soft else torch.zeros(self.n, dtype=torch.bool, device=device)
        self.opt_logit = t(cat("optLogit")) if has_soft else None
        # Training-only labels (shard.ts): the opponent's hand by card, the Prize difference at the end of the game.
        has_aux = all("aux" in p for p in parts)
        self.aux = t(cat("aux"), torch.bool) if has_aux else torch.zeros(self.n, dtype=torch.bool, device=device)
        self.opp_hand = t(cat("oppHand")) if has_aux else None
        self.prize_diff = t(cat("prizeDiff")) if has_aux else None
        assert self.slots.shape[1:] == (SLOTS, SLOT_F), self.slots.shape

    def batch(self, idx: torch.Tensor) -> dict[str, torch.Tensor]:
        count = self.opt_count[idx]
        k = int(count.max())
        ar = torch.arange(k, device=idx.device)
        mask = ar[None, :] < count[:, None]
        oi = (self.opt_start[idx][:, None] + ar[None, :]).clamp(max=self.opt_card.shape[0] - 1)
        oi = torch.where(mask, oi, torch.zeros_like(oi))
        out = {
            "slots": self.slots[idx].float(),
            "slot_cards": self.slot_cards[idx],
            "bags": self.bags[idx].float() / 4,
            "glob": self.glob[idx].float(),
            "source": self.source[idx],
            "opt_x": self.opt_x[oi].float() * mask[..., None],
            "opt_card": torch.where(mask, self.opt_card[oi], torch.zeros_like(oi)),
            "opt_slot": torch.where(mask, self.opt_slot[oi], torch.full_like(oi, -1)),
            "mask": mask,
        }
        if self.opt_logit is not None:
            # The recorded network's logits (imitation targets); rows without them have zeros (Data.soft says which).
            out["teacher"] = self.opt_logit[oi].float().masked_fill(~mask, -1e9)
        if self.opp_hand is not None:
            out["opp_hand"] = self.opp_hand[idx].float()
            out["prize_diff"] = self.prize_diff[idx].float()
            out["aux"] = self.aux[idx]
        return out


def load(dirs: list[str]) -> Data:
    paths = sorted(p for d in dirs for p in glob.glob(os.path.join(d, "*.bin")))
    if not paths:
        raise SystemExit(f"no shards in {dirs}")
    return Data(paths)


class Net(nn.Module):
    def __init__(self, vocab: int, glob_f: int, opt_f: int, dims: dict | None = None):
        super().__init__()
        self.vocab, self.glob_f, self.opt_f = vocab, glob_f, opt_f
        # Layer sizes (defaults = the shipped network; model.ts reads them from the JSON).
        d = {"E": E, "SH": SH, "BAGD": BAGD, "H": H, "OH": OH, **(dims or {})}
        self.dims = d
        E_, SH_, BAGD_, H_, OH_ = d["E"], d["SH"], d["BAGD"], d["H"], d["OH"]
        self.emb = nn.Embedding(vocab, E_)
        self.slot1 = nn.Linear(2 * E_ + SLOT_F, SH_)
        self.slot2 = nn.Linear(SH_, SH_)
        self.bag_w = nn.Parameter(torch.randn(BAGS, vocab, BAGD_) * 0.1)
        self.bag_b = nn.Parameter(torch.zeros(BAGS * BAGD_))
        trunk_in = 6 * SH_ + BAGS * BAGD_ + glob_f + E_
        self.trunk1 = nn.Linear(trunk_in, H_)
        self.trunk2 = nn.Linear(H_, H_)
        self.value1 = nn.Linear(H_, 64)
        self.value2 = nn.Linear(64, 1)
        self.opt1 = nn.Linear(E_ + SH_ + opt_f, OH_)
        self.q = nn.Linear(H_, OH_, bias=False)
        self.k = nn.Linear(OH_, OH_)
        self.score = nn.Linear(OH_, 1)

    def forward(self, b: dict[str, torch.Tensor]):
        slots = b["slots"]
        present = (slots[:, :, 0] > 0).float()
        sc = b["slot_cards"]
        tok = torch.cat([self.emb(sc[:, :, 0]), self.emb(sc[:, :, 1]), slots], -1)
        tok = F.relu(self.slot2(F.relu(self.slot1(tok)))) * present[..., None]

        def pool(first):
            t = tok[:, first : first + 8]
            m = present[:, first : first + 8]
            mean = t.sum(1) / m.sum(1).clamp(min=1)[:, None]
            return mean, t.max(1).values

        my_mean, my_max = pool(1)
        op_mean, op_max = pool(10)
        bags = torch.einsum("bnv,nvd->bnd", b["bags"], self.bag_w).reshape(slots.shape[0], -1) + self.bag_b
        z = torch.cat([tok[:, 0], my_mean, my_max, tok[:, 9], op_mean, op_max, bags, b["glob"], self.emb(b["source"])], -1)
        h = F.relu(self.trunk2(F.relu(self.trunk1(z))))
        value = self.value2(F.relu(self.value1(h))).squeeze(-1)

        slot = b["opt_slot"]
        st = torch.gather(tok, 1, slot.clamp(min=0)[..., None].expand(-1, -1, tok.shape[-1])) * (slot >= 0).float()[..., None]
        o = F.relu(self.opt1(torch.cat([self.emb(b["opt_card"]), st, b["opt_x"]], -1)))
        u = F.relu(self.q(h)[:, None, :] + self.k(o))
        logits = self.score(u).squeeze(-1).masked_fill(~b["mask"], -1e9)
        return logits, value


# Version 2 (src/bots/learn/model.ts): card vectors from printed features + a learned vector per trained card,
# bag weights projected from them, sizes of its own, no deck-name globals.
V2_DIMS = {"E": 32, "SH": 96, "BAGD": 16, "H": 512, "OH": 128}


_FEATURES: dict | None = None


def card_features() -> dict:
    """Card keys (encoder order), feature table (vocab x F, row 0 = no card) and the globals v2 keeps, from TypeScript.

    Read once per process (the cards don't change while it runs)."""
    global _FEATURES
    if _FEATURES is None:
        _FEATURES = _card_features()
    return {**_FEATURES, "table": _FEATURES["table"].clone()}


def _card_features() -> dict:
    import subprocess

    path = os.path.join(ROOT, ".cache", "learn", "features.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = subprocess.run(f'npx tsx scripts/learn/features.ts "{path}"', cwd=ROOT, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-2000:])
    with open(path) as f:
        j = json.load(f)
    j["table"] = torch.tensor(j["table"], dtype=torch.float32).reshape(len(j["cards"]) + 1, j["F"])
    return j


class Net2(nn.Module):
    """The v2 network. Same trunk and heads as Net; card vectors = id_emb[row] + feat(features)."""

    version = 2

    def __init__(self, feats: dict, glob_f: int, opt_f: int, dims: dict | None = None, id_drop: float = 0.0):
        super().__init__()
        d = {**V2_DIMS, **(dims or {})}
        self.dims, self.glob_f, self.opt_f, self.id_drop = d, glob_f, opt_f, id_drop
        self.cards = list(feats["cards"])
        self.register_buffer("feats", feats["table"].clone())
        self.register_buffer("glob_keep", torch.tensor(feats["globKeep"], dtype=torch.long))
        E_, SH_, BAGD_, H_, OH_ = d["E"], d["SH"], d["BAGD"], d["H"], d["OH"]
        cf = self.feats.shape[1]
        self.id_emb = nn.Embedding(len(self.cards) + 2, E_)
        nn.init.normal_(self.id_emb.weight, std=0.1)
        self.feat = nn.Linear(cf, E_)
        self.bag_p = nn.Parameter(torch.randn(BAGS, BAGD_, E_) * 0.1)
        self.bag_b = nn.Parameter(torch.zeros(BAGS * BAGD_))
        self.slot1 = nn.Linear(2 * E_ + SLOT_F, SH_)
        self.slot2 = nn.Linear(SH_, SH_)
        trunk_in = 6 * SH_ + BAGS * BAGD_ + len(feats["globKeep"]) + E_
        self.trunk1 = nn.Linear(trunk_in, H_)
        self.trunk2 = nn.Linear(H_, H_)
        self.value1 = nn.Linear(H_, 64)
        self.value2 = nn.Linear(64, 1)
        self.opt1 = nn.Linear(E_ + SH_ + opt_f, OH_)
        self.q = nn.Linear(H_, OH_, bias=False)
        self.k = nn.Linear(OH_, OH_)
        self.score = nn.Linear(OH_, 1)

    def card_vectors(self) -> torch.Tensor:
        v = self.feats.shape[0]
        # Vocab index v > 0 is cards[v - 1], id row v + 1 (row 0 = no card, 1 = unknown).
        ids = torch.arange(v, device=self.feats.device) + 1
        ids[0] = 0
        if self.training and self.id_drop > 0:
            drop = torch.rand(v, device=ids.device) < self.id_drop
            drop[0] = False
            ids = torch.where(drop, torch.ones_like(ids), ids)
        return self.id_emb(ids) + self.feat(self.feats)

    def frozen(self) -> dict[str, torch.Tensor]:
        """Card vectors and bag weights, fixed while the weights don't change (the inference server passes them in,
        so a captured CUDA graph does not rebuild them)."""
        with torch.no_grad():
            cv = self.card_vectors()
            return {"cv": cv, "bag_w": torch.einsum("nke,ve->nvk", self.bag_p, cv)}

    def forward(self, b: dict[str, torch.Tensor], frozen: dict[str, torch.Tensor] | None = None):
        cv = frozen["cv"] if frozen else self.card_vectors()
        slots = b["slots"]
        present = (slots[:, :, 0] > 0).float()
        sc = b["slot_cards"]
        tok = torch.cat([cv[sc[:, :, 0]], cv[sc[:, :, 1]], slots], -1)
        tok = F.relu(self.slot2(F.relu(self.slot1(tok)))) * present[..., None]

        def pool(first):
            t = tok[:, first : first + 8]
            m = present[:, first : first + 8]
            mean = t.sum(1) / m.sum(1).clamp(min=1)[:, None]
            return mean, t.max(1).values

        my_mean, my_max = pool(1)
        op_mean, op_max = pool(10)
        bag_w = frozen["bag_w"] if frozen else torch.einsum("nke,ve->nvk", self.bag_p, cv)
        bags = torch.einsum("bnv,nvk->bnk", b["bags"], bag_w).reshape(slots.shape[0], -1) + self.bag_b
        glob = b["glob"][:, self.glob_keep]
        z = torch.cat([tok[:, 0], my_mean, my_max, tok[:, 9], op_mean, op_max, bags, glob, cv[b["source"]]], -1)
        h = F.relu(self.trunk2(F.relu(self.trunk1(z))))
        value = self.value2(F.relu(self.value1(h))).squeeze(-1)

        slot = b["opt_slot"]
        st = torch.gather(tok, 1, slot.clamp(min=0)[..., None].expand(-1, -1, tok.shape[-1])) * (slot >= 0).float()[..., None]
        o = F.relu(self.opt1(torch.cat([cv[b["opt_card"]], st, b["opt_x"]], -1)))
        u = F.relu(self.q(h)[:, None, :] + self.k(o))
        logits = self.score(u).squeeze(-1).masked_fill(~b["mask"], -1e9)
        return logits, value


V2_NAMES = {
    "id.emb": "id_emb.weight", "feat.w": "feat.weight", "feat.b": "feat.bias", "bag.p": "bag_p", "bag.b": "bag_b",
    "slot1.w": "slot1.weight", "slot1.b": "slot1.bias", "slot2.w": "slot2.weight", "slot2.b": "slot2.bias",
    "trunk1.w": "trunk1.weight", "trunk1.b": "trunk1.bias", "trunk2.w": "trunk2.weight", "trunk2.b": "trunk2.bias",
    "value1.w": "value1.weight", "value1.b": "value1.bias", "value2.w": "value2.weight", "value2.b": "value2.bias",
    "opt1.w": "opt1.weight", "opt1.b": "opt1.bias", "q.w": "q.weight", "k.w": "k.weight", "att.b": "k.bias",
    "score.w": "score.weight", "score.b": "score.bias",
}


def new_net2(data: Data | None = None, dims: dict | None = None, id_drop: float = 0.15) -> Net2:
    glob_f = data.glob.shape[1] if data else 83
    opt_f = data.opt_x.shape[1] if data else 30
    return Net2(card_features(), glob_f, opt_f, dims, id_drop).to(DEVICE)


def write_json(out: dict, path: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, path)


def b64(v) -> dict:
    return {"shape": list(v.shape), "data": base64.b64encode(np.ascontiguousarray(v, dtype="<f4").tobytes()).decode()}


def new_net(data: Data | None = None, dims: dict | None = None) -> Net:
    vocab = len(card_keys()) + 1
    glob_f = data.glob.shape[1] if data else 83
    opt_f = data.opt_x.shape[1] if data else 30
    return Net(vocab, glob_f, opt_f, dims).to(DEVICE)


def export(net: Net | Net2, path: str, meta: dict | None = None) -> None:
    sd = {k: v.detach().float().cpu().numpy() for k, v in net.state_dict().items()}
    if getattr(net, "version", 1) == 3:
        from net3 import tensors3

        dims = {**net.dims, "SLOT_F": SLOT_F, "GLOB_F": net.glob_f, "OPT_F": net.opt_f, "CARD_F": int(net.feats.shape[1])}
        tensors = {k: b64(v.detach().float().cpu().numpy()) for k, v in tensors3(net).items()}
        write_json({"version": 3, "cards": net.cards, "dims": dims, "tensors": tensors, "meta": meta or {}}, path)
        return
    if isinstance(net, Net2):
        dims = {**net.dims, "SLOT_F": SLOT_F, "GLOB_F": net.glob_f, "OPT_F": net.opt_f, "CARD_F": int(net.feats.shape[1])}
        tensors = {k: b64(sd[v]) for k, v in V2_NAMES.items()}
        write_json({"version": 2, "cards": net.cards, "dims": dims, "tensors": tensors, "meta": meta or {}}, path)
        return
    names = {
        "emb": sd["emb.weight"],
        "slot1.w": sd["slot1.weight"], "slot1.b": sd["slot1.bias"],
        "slot2.w": sd["slot2.weight"], "slot2.b": sd["slot2.bias"],
        "bag.w": sd["bag_w"], "bag.b": sd["bag_b"],
        "trunk1.w": sd["trunk1.weight"], "trunk1.b": sd["trunk1.bias"],
        "trunk2.w": sd["trunk2.weight"], "trunk2.b": sd["trunk2.bias"],
        "value1.w": sd["value1.weight"], "value1.b": sd["value1.bias"],
        "value2.w": sd["value2.weight"], "value2.b": sd["value2.bias"],
        "opt1.w": sd["opt1.weight"], "opt1.b": sd["opt1.bias"],
        "q.w": sd["q.weight"],
        "k.w": sd["k.weight"], "att.b": sd["k.bias"],
        "score.w": sd["score.weight"], "score.b": sd["score.bias"],
    }
    out = {
        "cards": card_keys(),
        "dims": {**net.dims, "SLOT_F": SLOT_F, "GLOB_F": net.glob_f, "OPT_F": net.opt_f},
        "tensors": {
            k: {"shape": list(v.shape), "data": base64.b64encode(np.ascontiguousarray(v, dtype="<f4").tobytes()).decode()}
            for k, v in names.items()
        },
        "meta": meta or {},
    }
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f)
    os.replace(tmp, path)


def upgrade_bags(t: dict, sh: int) -> dict:
    """A network saved with fewer bags gets the new ones with zero weights, so it computes exactly what it did."""
    old = t["bag.w"].shape[0]
    if old >= BAGS:
        return t
    bagd = t["bag.w"].shape[2]
    t = dict(t)
    t["bag.w"] = torch.cat([t["bag.w"], torch.zeros(BAGS - old, t["bag.w"].shape[1], bagd)])
    t["bag.b"] = torch.cat([t["bag.b"], torch.zeros((BAGS - old) * bagd)])
    # trunk1 input: [6 pooled tokens (6*SH), bags (old*BAGD), globals, source]; new bag columns go after the old ones.
    w = t["trunk1.w"]
    at = 6 * sh + old * bagd
    t["trunk1.w"] = torch.cat([w[:, :at], torch.zeros(w.shape[0], (BAGS - old) * bagd), w[:, at:]], 1)
    return t


def import_json(path: str, id_drop: float = 0.15) -> Net | Net2:
    with open(path) as f:
        j = json.load(f)
    t = {k: torch.from_numpy(np.frombuffer(base64.b64decode(v["data"]), dtype="<f4").reshape(v["shape"]).copy()) for k, v in j["tensors"].items()}
    if j.get("version") == 3:
        from net3 import Net3

        feats = card_features()
        if feats["cards"] != j["cards"]:
            old = {k: i + 2 for i, k in enumerate(j["cards"])}
            t["id_emb.weight"] = t["id_emb.weight"][[0, 1] + [old.get(k, 1) for k in feats["cards"]]]
        dims = {k: j["dims"][k] for k in ("E", "D", "L", "HEADS", "FF", "C")}
        net3 = Net3(feats, j["dims"]["GLOB_F"], j["dims"]["OPT_F"], dims, id_drop)
        # The training-only heads (aux_*) are not in the file; they start again.
        missing, _ = net3.load_state_dict({**t, "feats": net3.feats, "glob_keep": net3.glob_keep}, strict=False)
        assert all(k.startswith("aux_") for k in missing), missing
        return net3.to(DEVICE)
    if j.get("version") == 2:
        feats = card_features()
        if feats["cards"] != j["cards"]:
            # Cards added since training: the trained ones keep their rows, new ones start at "unknown".
            old = {k: i + 2 for i, k in enumerate(j["cards"])}
            t["id.emb"] = t["id.emb"][[0, 1] + [old.get(k, 1) for k in feats["cards"]]]
        dims = {k: j["dims"][k] for k in ("E", "SH", "BAGD", "H", "OH")}
        net2 = Net2(feats, j["dims"]["GLOB_F"], j["dims"]["OPT_F"], dims, id_drop)
        sd = {v: t[k] for k, v in V2_NAMES.items()}
        sd["feats"], sd["glob_keep"] = net2.feats, net2.glob_keep
        net2.load_state_dict(sd)
        return net2.to(DEVICE)
    t = upgrade_bags(t, j["dims"]["SH"] if "SH" in j["dims"] else SH)
    net = Net(len(j["cards"]) + 1, j["dims"]["GLOB_F"], j["dims"]["OPT_F"], {k: j["dims"][k] for k in ("E", "SH", "BAGD", "H", "OH")})
    sd = {
        "emb.weight": t["emb"],
        "slot1.weight": t["slot1.w"], "slot1.bias": t["slot1.b"],
        "slot2.weight": t["slot2.w"], "slot2.bias": t["slot2.b"],
        "bag_w": t["bag.w"], "bag_b": t["bag.b"],
        "trunk1.weight": t["trunk1.w"], "trunk1.bias": t["trunk1.b"],
        "trunk2.weight": t["trunk2.w"], "trunk2.bias": t["trunk2.b"],
        "value1.weight": t["value1.w"], "value1.bias": t["value1.b"],
        "value2.weight": t["value2.w"], "value2.bias": t["value2.b"],
        "opt1.weight": t["opt1.w"], "opt1.bias": t["opt1.b"],
        "q.weight": t["q.w"],
        "k.weight": t["k.w"], "k.bias": t["att.b"],
        "score.weight": t["score.w"], "score.bias": t["score.b"],
    }
    net.load_state_dict(sd)
    return net.to(DEVICE)


class Gen:
    """scripts/learn/gen.ts running with a config (start_gen); wait() returns its JSON summary line."""

    def __init__(self, proc, path: str):
        self.proc = proc
        self.path = path

    def wait(self) -> dict:
        out, err = self.proc.communicate()
        lines = [l for l in out.splitlines() if l.startswith("{")]
        if self.proc.returncode != 0 or not lines:
            raise RuntimeError(f"gen failed ({self.proc.returncode}):\n{out[-2000:]}\n{err[-4000:]}")
        if err.strip():
            print(err.strip()[-1500:])
        return json.loads(lines[-1])


def start_gen(config: dict, path: str, server=None) -> Gen:
    """Start scripts/learn/gen.ts with a config (written to `path`) and return at once.

    With `server` (serve.Server), network players ask it for their forward passes (batched, on the GPU)."""
    import subprocess

    if server is not None:
        config = {**config, "server": {"port": server.port, **config.get("server", {})}}
    with open(path, "w") as f:
        json.dump(config, f)
    proc = subprocess.Popen(f'npx tsx scripts/learn/gen.ts "{path}"', cwd=ROOT, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
    return Gen(proc, path)


def run_gen(config: dict, path: str, server=None) -> dict:
    """Run scripts/learn/gen.ts with a config; returns its JSON summary line (see start_gen)."""
    return start_gen(config, path, server).wait()
