import importlib.util


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def is_downloaded(repo_id: str) -> bool:
    """True when the Hugging Face model files are already in the local cache."""
    try:
        from huggingface_hub import try_to_load_from_cache
    except ImportError:
        return False
    return isinstance(try_to_load_from_cache(repo_id, "config.json"), str)
