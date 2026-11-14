"""Synthetic documents reused by control-flow contract and execution tests."""

from typing import Any


def node(node_id: str, kind: str = "note", **extra: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": kind,
        "label": node_id.title(),
        "instructions": node_id,
        "position": {"x": 0, "y": 0},
        **extra,
    }


def edge(source: str, target: str, port: str = "next") -> dict[str, Any]:
    return {"source": source, "target": target, "source_port": port}


def predicate(source: str = "iteration", value: Any = 2, operator: str = "gte") -> dict[str, Any]:
    return {"left": {"source": source}, "operator": operator, "value": value}


def chain(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "0.2",
        "name": "Synthetic workflow",
        "start_node": nodes[0]["id"],
        "nodes": list(nodes),
        "edges": [edge(a["id"], b["id"]) for a, b in zip(nodes, nodes[1:], strict=False)],
    }


def split(kind: str = "fork") -> dict[str, Any]:
    config: dict[str, Any] = {"type": kind, "join": "join"}
    ports = ["left", "right"] if kind == "fork" else ["true", "false"]
    if kind == "fork":
        config["branches"] = ports
    else:
        config["condition"] = predicate("brief", "yes", "contains")
    return {
        "schema_version": "0.2",
        "name": "Synthetic branches",
        "start_node": "split",
        "nodes": [
            node("split", kind, config=config),
            node("left"),
            node("right"),
            node("longer"),
            node("join", "join"),
            node("finish", "finish"),
        ],
        "edges": [
            edge("split", "left", ports[0]),
            edge("split", "right", ports[1]),
            edge("left", "join"),
            edge("right", "longer"),
            edge("longer", "join"),
            edge("join", "finish"),
        ],
    }


def nested(kind: str = "subgraph", *, review: bool = False, until: bool = False) -> dict[str, Any]:
    config: dict[str, Any] = {"type": kind, "ref": {"id": "investigate", "version": 1}}
    if kind == "loop":
        config["max_iterations"] = 3
        if until:
            config["until"] = predicate()
    body = chain(node("inside", "review" if review else "note"), node("done", "finish"))
    body.pop("schema_version")
    result = chain(node("nested", kind, config=config), node("finish", "finish"))
    result["subgraphs"] = [{"id": "investigate", "version": 1, **body}]
    return result
