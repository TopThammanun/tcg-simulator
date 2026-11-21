"""A weights file with its tensors stored as float16: half the download for the play screen's experts (BOT-NEXT.md N1).

    ml/.venv/Scripts/python ml/half.py <in.json> <out.json>

Everything but the tensor bytes stays as it is; model.ts / model3.ts and common.import_json read both kinds.
Check the moves it changes with scripts/learn/half-check.ts before shipping one.
"""
import json
import sys

from common import b64, unb64, write_json


def main():
    src, dst = sys.argv[1], sys.argv[2]
    j = json.load(open(src))
    j["tensors"] = {k: b64(unb64(v), half=True) for k, v in j["tensors"].items()}
    write_json(j, dst)


if __name__ == "__main__":
    main()
