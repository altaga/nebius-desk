from app.edge.identity import board_identity, host_identity


def test_host_identity_has_triad_fields():
    row = host_identity()
    assert row["hostname"]
    assert row["os_user"]
    assert row["home"]
    assert row["desk_root"]
    assert "desk_root_is_home" in row


def test_board_identity_legend_separates_fleet_from_host():
    row = board_identity("Kratos")
    assert row["fleet_name"] == "Kratos"
    legend = row["legend"]
    assert "fleet_name=Kratos" in legend
    assert f"hostname={row['hostname']}" in legend
    assert f"os_user={row['os_user']}" in legend
    assert "Millie is the UI guide" in legend
