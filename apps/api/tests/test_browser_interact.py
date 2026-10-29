"""Live preview input mapping (no Chromium needed)."""

from __future__ import annotations

from app.browser import runtime


class _Mouse:
    def __init__(self, log: list) -> None:
        self.log = log

    def click(self, x: float, y: float) -> None:
        self.log.append(("click", round(x), round(y)))

    def wheel(self, dx: float, dy: float) -> None:
        self.log.append(("wheel", dx, dy))


class _Keyboard:
    def __init__(self, log: list) -> None:
        self.log = log

    def press(self, key: str) -> None:
        self.log.append(("press", key))

    def insert_text(self, text: str) -> None:
        self.log.append(("text", text))


class _Page:
    def __init__(self) -> None:
        self.log: list = []
        self.viewport_size = {"width": 960, "height": 540}
        self.mouse = _Mouse(self.log)
        self.keyboard = _Keyboard(self.log)

    def set_viewport_size(self, size: dict) -> None:
        self.viewport_size = dict(size)
        self.log.append(("viewport", size["width"], size["height"]))


def test_click_maps_fractions_to_viewport_pixels():
    page = _Page()
    assert runtime._interact(page, {"input": "click", "x": 0.5, "y": 0.25}) is None
    assert page.log == [("click", 480, 135)]


def test_click_clamps_out_of_frame_and_requires_coords():
    page = _Page()
    assert runtime._interact(page, {"input": "click", "x": 1.4, "y": -0.2}) is None
    assert page.log == [("click", 960, 0)]
    assert runtime._interact(page, {"input": "click"}) == "x and y required"


def test_scroll_key_and_text():
    page = _Page()
    assert runtime._interact(page, {"input": "scroll", "dy": 99999}) is None
    assert runtime._interact(page, {"input": "key", "key": "Enter"}) is None
    assert runtime._interact(page, {"input": "text", "text": "hola"}) is None
    assert page.log == [("wheel", 0, 4000.0), ("press", "Enter"), ("text", "hola")]


def test_rejects_unlisted_keys_and_unknown_input():
    page = _Page()
    assert runtime._interact(page, {"input": "key", "key": "Control+w"}).startswith("unsupported key")
    assert runtime._interact(page, {"input": "drag"}).startswith("unknown input")
    assert page.log == []


def test_viewport_resizes_only_when_changed_and_clamps():
    page = _Page()
    runtime._apply_viewport(page, {"width": 960, "height": 540})
    runtime._apply_viewport(page, {"width": 390, "height": 844})
    runtime._apply_viewport(page, {"width": 10, "height": 99999})
    runtime._apply_viewport(page, {"width": None, "height": 844})
    assert page.log == [("viewport", 390, 844), ("viewport", 240, 1920)]
