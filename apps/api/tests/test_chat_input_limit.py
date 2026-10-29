"""Chat and guide inputs are capped so one message can't blow up context or cost."""

import pytest
from pydantic import ValidationError

from app.chat.schemas import MAX_CHAT_INPUT_CHARS, SendMessageRequest
from app.guide.routes import GuideMessageRequest


def test_chat_accepts_up_to_cap():
    assert SendMessageRequest(content="x" * MAX_CHAT_INPUT_CHARS).content


def test_chat_rejects_over_cap():
    with pytest.raises(ValidationError):
        SendMessageRequest(content="x" * (MAX_CHAT_INPUT_CHARS + 1))


def test_guide_rejects_over_cap():
    assert GuideMessageRequest(content="x" * 4_000).content
    with pytest.raises(ValidationError):
        GuideMessageRequest(content="x" * 4_001)
