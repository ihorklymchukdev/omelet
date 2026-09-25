from pathlib import Path

from omelet_api.core.config import ApiConfig


def test_from_env_reads_the_names_the_container_will_set():
    # These names are the contract with the api service's compose file.
    config = ApiConfig.from_env({
        "OMELET_DOMAIN": "box.local",
        "OMELET_EDGE_PORT": "8080",
        "OMELET_PROJECTS_ROOT": "/srv/projects",
        "OMELET_STATE_DB": "/srv/state.db",
        "OMELET_SERVICE_VERSION": "1.2.3",
        "OMELET_API_HOST": "127.0.0.1",
        "OMELET_API_PORT": "9000",
    })
    assert config.domain == "box.local"
    assert config.edge_port == 8080, "the port must arrive as an int, not a string"
    assert config.projects_root == Path("/srv/projects")
    assert config.state_db == Path("/srv/state.db")
    assert config.version == "1.2.3"
    assert (config.bind_host, config.port) == ("127.0.0.1", 9000)


def test_github_client_id_can_be_overridden_for_a_fork():
    config = ApiConfig.from_env({"OMELET_GITHUB_CLIENT_ID": "Iv1.fork"})
    assert config.github_client_id == "Iv1.fork"
    assert ApiConfig.from_env({}).github_client_id == "Ov23lie5k9VqSCKI52Ci"
