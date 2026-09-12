"""Tiny message bus over ntfy.sh for two Claude sessions collaborating.

Usage:
  python coordination/agent_bus.py poll                 # print all messages so far
  python coordination/agent_bus.py listen               # stream new messages (Ctrl+C to stop)
  python coordination/agent_bus.py listen --forward ai-tinkerers-d2   # ...and relay each one to another topic
  python coordination/agent_bus.py send request "text"  # post a message (types: request/response/note)
  python coordination/agent_bus.py send response "text" --reply-to req-001

Message format (JSON in the ntfy body):
  {"from": "<node>", "type": "request|response|note", "id": "<msg id>",
   "body": "<text>", "reply_to": "<id of message being answered>"}

Env vars:
  AGENT_BUS_TOPIC   ntfy topic name   (default: claude9-agent-x7k9p2)
  AGENT_BUS_NODE    sender name       (default: hostname)
"""
import argparse
import json
import os
import socket
import sys
import time
import urllib.request

TOPIC = os.environ.get("AGENT_BUS_TOPIC", "claude9-agent-x7k9p2")
NODE = os.environ.get("AGENT_BUS_NODE", socket.gethostname())
BASE = f"https://ntfy.sh/{TOPIC}"


def _forward(evt: dict, topic: str) -> None:
    """Repost a received ntfy message verbatim to another topic."""
    body = evt.get("message", "")
    headers = {"Title": f"fwd from {evt.get('topic','')}"}
    req = urllib.request.Request(f"https://ntfy.sh/{topic}", data=body.encode(),
                                 method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        print(f"    -> forwarded to {topic}")
    except Exception as e:  # keep listening even if the forward fails
        print(f"    !! forward to {topic} failed: {e}")


def _print(raw_line: str, forward_to: str | None = None) -> None:
    try:
        evt = json.loads(raw_line)
    except json.JSONDecodeError:
        return
    if evt.get("event") != "message":
        return
    ts = time.strftime("%H:%M:%S", time.localtime(evt.get("time", 0)))
    try:
        msg = json.loads(evt.get("message", ""))
        print(f"[{ts}] {msg.get('from','?')} {msg.get('type','?')} {msg.get('id','')}"
              + (f" (re {msg['reply_to']})" if msg.get("reply_to") else "")
              + f": {msg.get('body','')}")
    except (json.JSONDecodeError, TypeError):
        print(f"[{ts}] raw: {evt.get('message')}")
    if forward_to:
        _forward(evt, forward_to)


def poll(since: str) -> None:
    url = f"{BASE}/json?poll=1&since={since}"
    with urllib.request.urlopen(url, timeout=30) as r:
        for line in r:
            _print(line.decode("utf-8", "replace"))


def listen(since: str, forward_to: str | None = None) -> None:
    url = f"{BASE}/json?since={since}"
    with urllib.request.urlopen(url, timeout=None) as r:
        for line in r:
            _print(line.decode("utf-8", "replace"), forward_to)
            sys.stdout.flush()


def send(msg_type: str, body: str, reply_to: str | None, msg_id: str | None) -> None:
    msg_id = msg_id or f"{msg_type[:3]}-{int(time.time())}"
    payload = {"from": NODE, "type": msg_type, "id": msg_id, "body": body}
    if reply_to:
        payload["reply_to"] = reply_to
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE, data=data, method="POST",
                                 headers={"Title": f"{NODE} {msg_type}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        r.read()
    print(f"sent {msg_id} to {TOPIC}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("poll"); sp.add_argument("--since", default="all")
    sl = sub.add_parser("listen"); sl.add_argument("--since", default="10m")
    sl.add_argument("--forward", metavar="TOPIC", help="repost every received message to this ntfy topic")
    ss = sub.add_parser("send")
    ss.add_argument("type", choices=["request", "response", "note"])
    ss.add_argument("body")
    ss.add_argument("--reply-to")
    ss.add_argument("--id")
    a = p.parse_args()
    if a.cmd == "poll":
        poll(a.since)
    elif a.cmd == "listen":
        listen(a.since, a.forward)
    else:
        send(a.type, a.body, a.reply_to, a.id)


if __name__ == "__main__":
    main()
