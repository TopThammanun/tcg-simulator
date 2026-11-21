"""Network version 3 (BOT-LEAP.md, L3): a transformer over every card the acting player can reason about.

It reads the same rows as version 2 (scripts/learn/shard.ts, src/bots/learn/encode.ts), so games, shards and the
inference server need nothing new; only the network differs. Tokens, each projected to D numbers by a small MLP
plus a learned type vector:
  global   1   the position's numbers (globals v2 keeps) + the card whose effect asks
  Pokémon  18  my Active and Bench, theirs (card, Tool, the 44 numbers of encode.ts); empty slots masked
  cards    64  one per card with a count in any zone (my hand, deck + Prizes, discard, theirs, Stadium, known top of
               my deck): the card's vector + its 8 counts. In card order; a position has at most 56 (measured)
  options  ≤K  one per legal action or pick: card, its 30 numbers, and the Pokémon token it points at
Every token attends to every live token (pre-LN blocks, GELU). Value: [global ‖ mean of live tokens] → MLP.
Policy: score = w·GELU(Wq global + Wk option + b) + c per option, like version 2.
src/bots/learn/model3.ts computes the same in TypeScript (scripts/learn/parity.ts checks it).
"""
from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from common import BAGS_V3, SLOT_F, SLOTS, glob_keep

V3_DIMS = {"E": 64, "D": 128, "L": 3, "HEADS": 4, "FF": 256, "C": 64}


def gelu(x: torch.Tensor) -> torch.Tensor:
    # The tanh form: model3.ts computes it with Math.tanh.
    return F.gelu(x, approximate="tanh")


class MLP(nn.Module):
    def __init__(self, n_in: int, hidden: int, n_out: int):
        super().__init__()
        self.a = nn.Linear(n_in, hidden)
        self.b = nn.Linear(hidden, n_out)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.b(gelu(self.a(x)))


class Block(nn.Module):
    def __init__(self, d: int, heads: int, ff: int):
        super().__init__()
        self.heads = heads
        self.ln1 = nn.LayerNorm(d)
        self.qkv = nn.Linear(d, 3 * d)
        self.out = nn.Linear(d, d)
        self.ln2 = nn.LayerNorm(d)
        self.ff1 = nn.Linear(d, ff)
        self.ff2 = nn.Linear(ff, d)

    def forward(self, x: torch.Tensor, keep: torch.Tensor) -> torch.Tensor:
        """`keep`: [B, T] bool, the live tokens (every token attends to the live ones only)."""
        B, T, D = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(B, T, 3, self.heads, D // self.heads).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=keep[:, None, None, :])
        x = x + self.out(y.transpose(1, 2).reshape(B, T, D))
        return x + self.ff2(gelu(self.ff1(self.ln2(x))))


class Net3(nn.Module):
    version = 3

    def __init__(self, feats: dict, glob_f: int, opt_f: int, dims: dict | None = None, id_drop: float = 0.0, bags: int = BAGS_V3):
        super().__init__()
        d = {**V3_DIMS, **(dims or {})}
        self.dims, self.glob_f, self.opt_f, self.id_drop, self.bags = d, glob_f, opt_f, id_drop, bags
        self.cards = list(feats["cards"])
        self.register_buffer("feats", feats["table"].clone())
        keep = glob_keep(glob_f)
        self.register_buffer("glob_keep", torch.tensor(keep, dtype=torch.long))
        E, D = d["E"], d["D"]
        self.id_emb = nn.Embedding(len(self.cards) + 2, E)
        nn.init.normal_(self.id_emb.weight, std=0.1)
        self.feat = nn.Linear(self.feats.shape[1], E)
        self.glob_in = MLP(len(keep) + E, D, D)
        self.slot_in = MLP(2 * E + SLOT_F, D, D)
        self.card_in = MLP(E + bags, D, D)
        self.opt_in = MLP(E + opt_f + D, D, D)
        self.kind = nn.Parameter(torch.zeros(4, D))
        self.blocks = nn.ModuleList(Block(D, d["HEADS"], d["FF"]) for _ in range(d["L"]))
        self.norm = nn.LayerNorm(D)
        self.value = MLP(2 * D, 2 * D, 1)
        self.q = nn.Linear(D, D, bias=False)
        self.k = nn.Linear(D, D)
        self.score = nn.Linear(D, 1)
        # Training only (KataGo-style targets, not written to the JSON): how many of each card the opponent holds
        # (per card token), and the Prize difference at the end of the game / 6 (from the global token).
        self.aux_hand = nn.Linear(D, 1)
        self.aux_prize = nn.Linear(D, 1)

    def card_vectors(self) -> torch.Tensor:
        """Version 2's card vectors: id_emb[row] + feat(features); row 0 = no card, 1 = unknown."""
        v = self.feats.shape[0]
        ids = torch.arange(v, device=self.feats.device) + 1
        ids[0] = 0
        if self.training and self.id_drop > 0:
            drop = torch.rand(v, device=ids.device) < self.id_drop
            drop[0] = False
            ids = torch.where(drop, torch.ones_like(ids), ids)
        return self.id_emb(ids) + self.feat(self.feats)

    def frozen(self) -> dict[str, torch.Tensor]:
        """Card vectors, fixed while the weights don't change (the inference server passes them in)."""
        with torch.no_grad():
            return {"cv": self.card_vectors()}

    def tokens(self, b: dict[str, torch.Tensor], cv: torch.Tensor):
        """All tokens [B, T, D], which are live [B, T], where the options start, and the card tokens' cards [B, C].

        C is dims["C"], or b["C"] when the batch needs fewer card tokens (ppo.py: the most cards any of its rows
        has); the tokens cut off would all be masked, so the result is the same."""
        slots, sc = b["slots"], b["slot_cards"]
        present = slots[:, :, 0] > 0
        slot_x = self.slot_in(torch.cat([cv[sc[:, :, 0]], cv[sc[:, :, 1]], slots], -1)) + self.kind[1]
        # Cards with a count in the first 8 bags, in card order (stable sort puts them first), C of them; each token
        # reads the card's counts in every bag the network reads.
        bags = b["bags"][:, : self.bags]
        has = b["bags"][:, :BAGS_V3].sum(1) > 0
        has[:, 0] = False
        C = min(int(b["C"]), self.dims["C"]) if "C" in b else self.dims["C"]
        order = torch.argsort(has.to(torch.int8), dim=1, descending=True, stable=True)[:, :C]
        card_keep = torch.gather(has, 1, order)
        counts = torch.gather(bags, 2, order[:, None, :].expand(-1, bags.shape[1], -1)).transpose(1, 2)
        card_x = self.card_in(torch.cat([cv[order], counts], -1)) + self.kind[2]
        g = self.glob_in(torch.cat([b["glob"][:, self.glob_keep], cv[b["source"]]], -1))[:, None] + self.kind[0]
        slot = b["opt_slot"]
        target = torch.gather(slot_x, 1, slot.clamp(min=0)[..., None].expand(-1, -1, slot_x.shape[-1])) * (slot >= 0)[..., None]
        opt_x = self.opt_in(torch.cat([cv[b["opt_card"]], b["opt_x"][..., : self.opt_f], target], -1)) + self.kind[3]
        x = torch.cat([g, slot_x, card_x, opt_x], 1)
        keep = torch.cat([torch.ones_like(present[:, :1]), present, card_keep, b["mask"]], 1)
        return x, keep, 1 + SLOTS + C, order, card_keep

    def trunk(self, b: dict[str, torch.Tensor], frozen: dict[str, torch.Tensor] | None = None):
        cv = frozen["cv"] if frozen else self.card_vectors()
        x, keep, first_opt, order, card_keep = self.tokens(b, cv)
        for blk in self.blocks:
            x = blk(x, keep)
        return self.norm(x), keep, first_opt, order, card_keep

    def forward(self, b: dict[str, torch.Tensor], frozen: dict[str, torch.Tensor] | None = None):
        x, keep, first_opt, _, _ = self.trunk(b, frozen)
        return self.heads(x, keep, first_opt, b)

    def forward_aux(self, b: dict[str, torch.Tensor]):
        """forward() plus the training-only predictions and the targets they are compared with (aux_loss)."""
        out = self.forward_train(b)
        return out["logits"], out["value"], out["aux"]

    def forward_train(self, b: dict[str, torch.Tensor], critic: bool = False) -> dict[str, torch.Tensor]:
        """What ppo.py trains: logits, value, the training-only predictions (aux_loss), and with `critic` the value
        logit of the critic that sees all (`self.critic`, common.Critic)."""
        cv = self.card_vectors()
        x, keep, first_opt, order, card_keep = self.tokens(b, cv)
        for blk in self.blocks:
            x = blk(x, keep)
        x = self.norm(x)
        logits, value, h = self.heads(x, keep, first_opt, b, full=True)
        cards = x[:, 1 + SLOTS : first_opt]
        out = {
            "logits": logits,
            "value": value,
            "aux": {
                "hand": F.softplus(self.aux_hand(cards).squeeze(-1)),
                "order": order,
                "card_keep": card_keep,
                "prize": self.aux_prize(x[:, 0]).squeeze(-1),
            },
        }
        if critic:
            out["critic"] = self.critic(h, cv, b)
        return out

    def critic_size(self) -> tuple[int, int]:
        """The width of what the critic reads besides the hidden cards, and of a card vector."""
        return 2 * self.dims["D"], self.dims["E"]

    def heads(self, x: torch.Tensor, keep: torch.Tensor, first_opt: int, b: dict[str, torch.Tensor], full: bool = False):
        g = x[:, 0]
        w = keep.to(x.dtype)[..., None]
        mean = (x * w).sum(1) / w.sum(1)
        h = torch.cat([g, mean], -1)
        value = self.value(h).squeeze(-1)
        u = gelu(self.q(g)[:, None, :] + self.k(x[:, first_opt:]))
        logits = self.score(u).squeeze(-1).masked_fill(~b["mask"], -1e9)
        return (logits, value, h) if full else (logits, value)


def new_net3(glob_f: int = 91, opt_f: int = 38, dims: dict | None = None, id_drop: float = 0.15, bags: int = 11) -> Net3:
    from common import DEVICE, card_features

    return Net3(card_features(), glob_f, opt_f, dims, id_drop, bags).to(DEVICE)


def aux_loss(aux: dict[str, torch.Tensor], b: dict[str, torch.Tensor]) -> torch.Tensor:
    """Squared error of the training-only predictions, on rows that have the labels (Data: oppHand, prizeDiff)."""
    if "opp_hand" not in b:
        return torch.zeros((), device=aux["prize"].device)
    rows = b["aux"]
    want = torch.gather(b["opp_hand"], 1, aux["order"])
    m = (aux["card_keep"] & rows[:, None]).to(want.dtype)
    hand = (((aux["hand"].float() - want) ** 2) * m).sum() / m.sum().clamp(min=1)
    r = rows.to(want.dtype)
    prize = (((aux["prize"].float() - b["prize_diff"] / 6) ** 2) * r).sum() / r.sum().clamp(min=1)
    return hand + prize


# Tensors written to the JSON file: every parameter but the training-only heads, by its PyTorch name (model3.ts
# reads the same names).
def tensors3(net: Net3) -> dict[str, torch.Tensor]:
    return {k: v for k, v in net.state_dict().items() if k not in ("feats", "glob_keep") and not k.startswith("aux_")}


def param_count(net: nn.Module) -> int:
    return sum(p.numel() for p in net.parameters())


def attention_check() -> None:
    """SDPA with a boolean mask = softmax over the live keys (model3.ts does it by hand)."""
    q = torch.randn(2, 4, 5, 8)
    k = torch.randn(2, 4, 5, 8)
    v = torch.randn(2, 4, 5, 8)
    keep = torch.tensor([[True, True, False, True, False], [True] * 5])
    a = F.scaled_dot_product_attention(q, k, v, attn_mask=keep[:, None, None, :])
    s = (q @ k.transpose(-1, -2)) / math.sqrt(8)
    s = s.masked_fill(~keep[:, None, None, :], float("-inf"))
    assert torch.allclose(a, s.softmax(-1) @ v, atol=1e-5)
