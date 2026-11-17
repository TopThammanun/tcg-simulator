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
        raw = f.read()
    (n,) = struct.unpack("<Q", raw[:8])
    header = json.loads(raw[8 : 8 + n])
    base = 8 + n
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
        assert self.slots.shape[1:] == (SLOTS, SLOT_F), self.slots.shape

    def batch(self, idx: torch.Tensor) -> dict[str, torch.Tensor]:
        count = self.opt_count[idx]
        k = int(count.max())
        ar = torch.arange(k, device=idx.device)
        mask = ar[None, :] < count[:, None]
        oi = (self.opt_start[idx][:, None] + ar[None, :]).clamp(max=self.opt_card.shape[0] - 1)
        oi = torch.where(mask, oi, torch.zeros_like(oi))
        return {
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


def new_net(data: Data | None = None, dims: dict | None = None) -> Net:
    vocab = len(card_keys()) + 1
    glob_f = data.glob.shape[1] if data else 83
    opt_f = data.opt_x.shape[1] if data else 30
    return Net(vocab, glob_f, opt_f, dims).to(DEVICE)


def export(net: Net, path: str, meta: dict | None = None) -> None:
    sd = {k: v.detach().float().cpu().numpy() for k, v in net.state_dict().items()}
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


def import_json(path: str) -> Net:
    with open(path) as f:
        j = json.load(f)
    t = {k: torch.from_numpy(np.frombuffer(base64.b64decode(v["data"]), dtype="<f4").reshape(v["shape"]).copy()) for k, v in j["tensors"].items()}
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


def run_gen(config: dict, path: str) -> dict:
    """Run scripts/learn/gen.ts with a config; returns its JSON summary line."""
    import subprocess

    with open(path, "w") as f:
        json.dump(config, f)
    r = subprocess.run(f'npx tsx scripts/learn/gen.ts "{path}"', cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf-8")
    lines = [l for l in r.stdout.splitlines() if l.startswith("{")]
    if r.returncode != 0 or not lines:
        raise RuntimeError(f"gen failed ({r.returncode}):\n{r.stdout[-2000:]}\n{r.stderr[-4000:]}")
    if r.stderr.strip():
        print(r.stderr.strip()[-1500:])
    return json.loads(lines[-1])
