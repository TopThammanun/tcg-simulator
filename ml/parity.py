"""Check that PyTorch and src/bots/learn/model.ts give the same outputs (run scripts/learn/parity.ts first).

    ml/.venv/Scripts/python ml/parity.py <model.json> <dir>
"""
import json
import sys

import torch

from common import load, import_json

net = import_json(sys.argv[1])
net.train(False)
data = load([sys.argv[2]])
expected = json.load(open(f"{sys.argv[2]}/expected.json"))
assert len(expected) == data.n, (len(expected), data.n)
worst_v, worst_l = 0.0, 0.0
with torch.no_grad():
    idx = torch.arange(data.n, device=data.slots.device)
    logits, value = net(data.batch(idx))
    value = torch.sigmoid(value).cpu()
    logits = logits.cpu()
for i, e in enumerate(expected):
    worst_v = max(worst_v, abs(value[i].item() - e["value"]))
    k = len(e["logits"])
    worst_l = max(worst_l, (logits[i, :k] - torch.tensor(e["logits"])).abs().max().item())
print(f"{data.n} decisions: max |value diff| {worst_v:.2e}, max |logit diff| {worst_l:.2e}")
sys.exit(0 if worst_v < 1e-4 and worst_l < 1e-3 else 1)
