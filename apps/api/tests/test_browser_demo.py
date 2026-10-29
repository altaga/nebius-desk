from app.browser import demo
from app.chat.desk_tools import ToolCall, extract_tools, infer_board_tools, tools_match_intent


def test_record_spec_with_header_and_steps():
    spec = demo.parse_record_spec(
        "url: http://127.0.0.1:5173\nsize: 1080p\nformat: mp4\nname: My demo!\nsteps:\n"
        "- wait 2\n- click text=Count\n- type input[name=q] :: hello world\n- press Control+A\n"
        "- scroll -400\n- goto https://example.com"
    )
    assert spec.errors == [] and spec.step_errors == []
    assert (spec.url, spec.width, spec.height, spec.fmt, spec.name) == (
        "http://127.0.0.1:5173", 1920, 1080, "mp4", "My-demo"
    )
    assert [s.op for s in spec.steps] == ["wait", "click", "type", "press", "scroll", "goto"]
    assert spec.steps[2].target == "input[name=q]" and spec.steps[2].text == "hello world"
    assert spec.steps[4].dy == -400


def test_record_spec_defaults_and_bare_steps():
    spec = demo.parse_record_spec("url: https://example.com\nwait 1\nscroll")
    assert spec.fmt == "webm" and (spec.width, spec.height) == (1280, 720)
    assert [s.op for s in spec.steps] == ["wait", "scroll"]
    assert demo.parse_record_spec("url: https://example.com").steps[0].op == "wait"


def test_record_spec_rejects_bad_input():
    spec = demo.parse_record_spec("url: file:///etc/passwd\nformat: avi\nsize: huge")
    assert len(spec.errors) == 3
    spec = demo.parse_record_spec(
        "url: http://x.test\n---\nwait 999\nexplode now\npress rm -rf\ntype nothing\ngoto javascript:alert(1)"
    )
    assert spec.steps[0].seconds == demo.MAX_WAIT_SECONDS
    assert len(spec.step_errors) == 4


def test_record_steps_are_capped():
    _, errors = demo.parse_steps("\n".join(["wait 0"] * (demo.MAX_STEPS + 5)))
    assert errors == [f"only the first {demo.MAX_STEPS} steps run"]


def test_render_spec_svg_and_options():
    spec = demo.parse_render_spec("size: 800x400\nscale: 2x\nout: Images/card.png\n<svg width='10'></svg>")
    assert spec.errors == []
    assert (spec.width, spec.height, spec.scale, spec.out) == (800, 400, 2, "Images/card.png")
    assert spec.html.startswith("<!doctype html>") and "<svg" in spec.html


def test_render_spec_errors():
    assert demo.parse_render_spec("size: 800x400\n").errors
    assert demo.parse_render_spec("out: a.gif\n---\n<p>x</p>").errors == ["out must end in .png or .jpg"]


def test_safe_name_strips_paths_and_extensions():
    assert demo.safe_name("../../etc/passwd") == "etc-passwd"
    assert demo.safe_name("launch.mp4") == "launch"
    assert demo.safe_name("") == "demo"


def test_record_and_render_fences_parse():
    _, calls = extract_tools("ok\n```record\nurl: http://127.0.0.1:5173\n```\n```render\n<svg></svg>\n```")
    assert [c.kind for c in calls] == ["record", "render"]
    assert "127.0.0.1:5173" in calls[0].summary()["url"]


def test_record_intent_needs_video_context():
    rec = [ToolCall(kind="record", body="url: http://127.0.0.1:5173")]
    lst = [ToolCall(kind="list", body="")]
    assert not tools_match_intent("graba un video demo de http://127.0.0.1:5173", lst)
    assert tools_match_intent("graba un video demo de http://127.0.0.1:5173", rec)
    assert tools_match_intent("record a screen cast of the app", rec)
    # "grabar" as "save" and React "render" must not force media tools.
    assert not demo_forced("graba los cambios en el archivo")
    assert not demo_forced("why does my component render twice?")


def demo_forced(text: str) -> bool:
    return not tools_match_intent(text, [ToolCall(kind="read", body="src/App.tsx")]) and bool(
        infer_board_tools(text) and infer_board_tools(text)[0].kind in ("record", "render")
    )


def test_infer_record_uses_url_from_text():
    calls = infer_board_tools("grábame un video de http://127.0.0.1:4173/about por favor")
    assert calls[0].kind == "record"
    spec = demo.parse_record_spec(calls[0].body)
    assert spec.url == "http://127.0.0.1:4173/about" and spec.errors == [] and spec.fmt == "mp4"
