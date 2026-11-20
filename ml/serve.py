"""Inference server for batched self-play (BOT-LEAP.md, L1).

gen.ts workers (scripts/learn/batched.ts) send every decision that waits for a network; the server runs them on
the GPU, all waiting requests at once, one forward pass per network, and sends back each row's value and option
logits. It runs on a thread of the training process (ppo.py, match.py), so the GPU and the loaded networks are
shared. Networks are named by their weights file and loaded again when the file changes (ppo.py rewrites
current.json every iteration).

Frames both ways: u32 payload bytes, u32 request id, payload. Request: u32 length of a JSON list of weights
files, the list, then the rows as a shard (scripts/learn/shard.ts) with a `model` index per row. Answer: one
float32 value per row (the chance to win of the player deciding), then the float32 logits of every row's options
in order. An empty answer means the batch failed (the error is printed here).
"""
from __future__ import annotations

import json
import os
import selectors
import socket
import struct
import sys
import threading
import time
import traceback

import numpy as np
import torch

from common import DEVICE, import_json, parse_shard

# Arrays per row and per option that a forward pass reads.
ROW_KEYS = ("slots", "slotCards", "bags", "glob", "source", "optCount")
OPT_KEYS = ("optX", "optCard", "optSlot")


class _Conn:
    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buf = bytearray()


class Server:
    """One thread does everything: read whatever every connection has sent, answer all complete requests as one
    batch, repeat. While the GPU works, new requests wait in the sockets, so batches grow with the load. (Threads
    per connection were slower: they wait for the GIL, so requests reached the batch a few at a time.)"""

    def __init__(self, port: int = 0, device=DEVICE, keep: int = 4):
        self.port = port
        self.device = device
        self.keep = keep
        self.models: dict[str, tuple[float, float, Graphed]] = {}
        self.batches = 0
        self.rows = 0

    def start(self) -> "Server":
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # A request is often bigger than the default 64 KB buffer.
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16 << 20)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(128)
        self.sock.setblocking(False)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._loop, daemon=True, name="inference-server").start()
        return self

    def _loop(self) -> None:
        sel = selectors.DefaultSelector()
        sel.register(self.sock, selectors.EVENT_READ, None)
        chunk = bytearray(1 << 20)
        view = memoryview(chunk)
        pending: list[tuple[_Conn, int, bytes]] = []

        def read(events) -> None:
            for key, _ in events:
                if key.data is None:
                    try:
                        sock, _ = self.sock.accept()
                    except BlockingIOError:
                        continue
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16 << 20)
                    sock.setblocking(False)
                    sel.register(sock, selectors.EVENT_READ, _Conn(sock))
                    continue
                c: _Conn = key.data
                while True:
                    try:
                        k = c.sock.recv_into(view)
                    except BlockingIOError:
                        break
                    except OSError:
                        k = 0
                    if k == 0:
                        sel.unregister(c.sock)
                        c.sock.close()
                        break
                    c.buf += view[:k]
                while len(c.buf) >= 8:
                    n, rid = struct.unpack_from("<II", c.buf, 0)
                    if len(c.buf) < 8 + n:
                        break
                    pending.append((c, rid, bytes(c.buf[8 : 8 + n])))
                    del c.buf[: 8 + n]

        while True:
            read(sel.select(timeout=None))
            # Everything else that has already arrived joins this batch.
            while True:
                events = sel.select(timeout=0)
                if not events:
                    break
                read(events)
            if not pending:
                continue
            items, pending = pending, []
            try:
                answers = self.infer([p for _, _, p in items])
            except Exception:
                traceback.print_exc(file=sys.stderr)
                answers = [b""] * len(items)
            for (c, rid, _), body in zip(items, answers):
                frame = struct.pack("<II", len(body), rid) + body
                try:
                    c.sock.sendall(frame)
                except BlockingIOError:
                    c.sock.setblocking(True)
                    c.sock.sendall(frame)
                    c.sock.setblocking(False)
                except OSError:
                    pass

    def model(self, path: str) -> "Graphed":
        # The file is looked at again at most twice a second (a stat per batch costs more than the batch's math).
        now = time.monotonic()
        got = self.models.get(path)
        if got is not None and now - got[1] < 0.5:
            return got[2]
        mtime = os.path.getmtime(path)
        if got is None or got[0] != mtime:
            net = import_json(path, id_drop=0.0).to(self.device)
            net.train(False)
            got = (mtime, now, Graphed(net, self.device))
            # Keep the networks used most recently (ppo.py's league changes every iteration; graphs hold GPU memory).
            for old in sorted(self.models, key=lambda p: self.models[p][1])[: max(0, len(self.models) - self.keep + 1)]:
                if old != path:
                    del self.models[old]
        else:
            got = (got[0], now, got[2])
        self.models[path] = got
        return got[2]

    def infer(self, payloads: list[bytes]) -> list[bytes]:
        parts: list[dict[str, np.ndarray]] = []
        paths: list[str] = []
        for p in payloads:
            (k,) = struct.unpack_from("<I", p, 0)
            models = json.loads(bytes(p[4 : 4 + k]))
            sh = parse_shard(p, 4 + k)
            for m in models:
                if m not in paths:
                    paths.append(m)
            glob_index = np.array([paths.index(m) for m in models], dtype=np.int64)
            sh["model"] = glob_index[sh["model"].astype(np.int64)]
            parts.append(sh)
        rows = [len(sh["source"]) for sh in parts]
        opts = [len(sh["optCard"]) for sh in parts]
        a = {k: np.concatenate([sh[k] for sh in parts]) for k in (*ROW_KEYS, *OPT_KEYS, "model")}
        count = a["optCount"].astype(np.int64)
        value = np.empty(sum(rows), dtype="<f4")
        logits = np.empty(sum(opts), dtype="<f4")
        opt_model = np.repeat(a["model"], count)
        for k, path in enumerate(paths):
            sel = a["model"] == k
            osel = opt_model == k
            sub = {key: a[key][sel] for key in ROW_KEYS}
            sub.update({key: a[key][osel] for key in OPT_KEYS})
            value[sel], logits[osel] = self.model(path).run(sub)
        self.batches += 1
        self.rows += len(value)
        out, r0, o0 = [], 0, 0
        for nr, no in zip(rows, opts):
            out.append(value[r0 : r0 + nr].tobytes() + logits[o0 : o0 + no].tobytes())
            r0 += nr
            o0 += no
        return out


def pad(a: dict[str, np.ndarray], R: int, K: int) -> tuple[dict[str, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """The rows of `a` (shard arrays, in their stored types) padded to `R` rows and `K` options a row, and where each
    option landed (row, column). `inputs` turns them into what Net.forward takes."""
    count = a["optCount"].astype(np.int64)
    n = len(count)
    starts = np.concatenate([[0], np.cumsum(count)[:-1]]).astype(np.int64)
    row = np.repeat(np.arange(n), count)
    col = np.arange(int(count.sum())) - np.repeat(starts, count)

    def rows(x: np.ndarray) -> np.ndarray:
        out = np.zeros((R, *x.shape[1:]), x.dtype)
        out[:n] = x
        return out

    def opts(x: np.ndarray, fill: int = 0) -> np.ndarray:
        out = np.full((R, K, *x.shape[1:]), fill, x.dtype)
        out[row, col] = x
        return out

    mask = np.zeros((R, K), bool)
    mask[row, col] = True
    b = {
        "slots": rows(a["slots"]),
        "slot_cards": rows(a["slotCards"]),
        "bags": rows(a["bags"]),
        "glob": rows(a["glob"]),
        "source": rows(a["source"]),
        "opt_x": opts(a["optX"]),
        "opt_card": opts(a["optCard"]),
        "opt_slot": opts(a["optSlot"], -1),
        "mask": mask,
    }
    return b, (row, col)


def inputs(raw: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
    """Net.forward's inputs from the stored types (as Data.batch makes them): floats, long indices, bags / 4."""
    return {
        "slots": raw["slots"].float(),
        "slot_cards": raw["slot_cards"].long(),
        "bags": raw["bags"].float() / 4,
        "glob": raw["glob"].float(),
        "source": raw["source"].long(),
        "opt_x": raw["opt_x"].float(),
        "opt_card": raw["opt_card"].long(),
        "opt_slot": raw["opt_slot"].long(),
        "mask": raw["mask"],
    }


class Graphed:
    """A network's forward pass captured as CUDA graphs, one per (rows, options) size: a batch is padded to the next
    size, copied into the captured inputs in its stored types (float16, bytes) and replayed; the graph converts the
    types and returns value and logits in one tensor. One call and two copies instead of about a hundred small ops,
    which is what a batch cost before (Python's overhead per op, not the math). Bigger batches go in pieces; rows
    with more options than the largest size run without a graph."""

    ROWS = (32, 64, 128, 192, 256, 384, 512, 768, 1024)
    OPTS = (16, 32, 64)

    def __init__(self, net: torch.nn.Module, device):
        self.net = net
        self.device = device
        self.frozen = net.frozen() if hasattr(net, "frozen") else None
        self.graphs: dict[tuple[int, int], tuple[torch.cuda.CUDAGraph, dict[str, torch.Tensor], torch.Tensor]] = {}
        self.cuda = torch.device(device).type == "cuda" and self.frozen is not None
        # The graphs of one network run one at a time, so they can share their working memory.
        self.pool = torch.cuda.graph_pool_handle() if self.cuda else None

    def forward(self, raw: dict[str, torch.Tensor]) -> torch.Tensor:
        """[value (chance to win) | logits] per row."""
        b = inputs(raw)
        lg, v = self.net(b, self.frozen) if self.frozen is not None else self.net(b)
        return torch.cat([torch.sigmoid(v)[:, None], lg], 1)

    def _graph(self, like: dict[str, np.ndarray], R: int, K: int):
        g = self.graphs.get((R, K))
        if g is None:
            static = {k: torch.from_numpy(x).to(self.device) for k, x in like.items()}
            side = torch.cuda.Stream()
            side.wait_stream(torch.cuda.current_stream())
            with torch.cuda.stream(side), torch.no_grad():
                for _ in range(2):
                    self.forward(static)
            torch.cuda.current_stream().wait_stream(side)
            graph = torch.cuda.CUDAGraph()
            # thread_local: the training thread (ppo.py) keeps using the GPU while a graph is captured here.
            with torch.cuda.graph(graph, pool=self.pool, capture_error_mode="thread_local"), torch.no_grad():
                out = self.forward(static)
            g = (graph, static, out)
            self.graphs[(R, K)] = g
        return g

    @torch.no_grad()
    def run(self, a: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        """Value per row (chance to win) and the logits of every row's options, flat in order."""
        count = a["optCount"].astype(np.int64)
        n = len(count)
        ostart = np.concatenate([[0], np.cumsum(count)])
        values, logits = [], []
        top = self.ROWS[-1]
        for r0 in range(0, n, top):
            r1 = min(n, r0 + top)
            o0, o1 = int(ostart[r0]), int(ostart[r1])
            part = {k: a[k][r0:r1] for k in ROW_KEYS}
            part.update({k: a[k][o0:o1] for k in OPT_KEYS})
            k_max = int(count[r0:r1].max())
            K = next((x for x in self.OPTS if x >= k_max), None)
            if K is None or not self.cuda:
                b, (row, col) = pad(part, r1 - r0, k_max)
                out = self.forward({k: torch.from_numpy(x).to(self.device) for k, x in b.items()})
            else:
                R = next(x for x in self.ROWS if x >= r1 - r0)
                b, (row, col) = pad(part, R, K)
                graph, static, out = self._graph(b, R, K)
                for k, x in b.items():
                    static[k].copy_(torch.from_numpy(x))
                graph.replay()
            o = out.cpu().numpy()
            values.append(o[: r1 - r0, 0])
            logits.append(o[:, 1:][row, col])
        return np.concatenate(values).astype("<f4"), np.concatenate(logits).astype("<f4")
