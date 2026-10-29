from app.edge.services import _is_html_page, _url_from_docker_ports, list_services


def test_url_from_docker_ports():
    assert _url_from_docker_ports("0.0.0.0:5173->5173/tcp") == "http://127.0.0.1:5173"
    assert _url_from_docker_ports("127.0.0.1:3000->3000/tcp") == "http://127.0.0.1:3000"
    assert _url_from_docker_ports("0.0.0.0:11434->11434/tcp") is None
    assert _url_from_docker_ports("") is None


def test_is_html_page_accepts_vite_style():
    assert _is_html_page(
        {
            "status": 200,
            "content_type": "text/html; charset=utf-8",
            "body": "<!DOCTYPE html><html><title>Vite App</title></html>",
            "title": "Vite App",
            "server": None,
        }
    )


def test_is_html_page_rejects_ollama_and_llamacpp():
    assert not _is_html_page(
        {
            "status": 200,
            "content_type": "text/plain; charset=utf-8",
            "body": "Ollama is running",
            "title": None,
            "server": None,
        }
    )
    assert not _is_html_page(
        {
            "status": 404,
            "content_type": "application/json; charset=utf-8",
            "body": '{"error":{"message":"File Not Found","type":"not_found_error","code":404}}',
            "title": None,
            "server": "llama.cpp",
        }
    )


def test_list_services_shape():
    data = list_services(include_containers=False)
    assert "services" in data
    assert "previewable" in data
    assert "has_preview" in data
    assert data["has_preview"] == bool(data["previewable"])
    # Board LLM APIs must never appear as pages.
    for s in data["services"]:
        assert s.get("port") != 11434
        assert (s.get("server") or "").lower() != "llama.cpp"
