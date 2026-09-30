"""Owner-only local state for selected evidence and Flower results."""

import os
from pathlib import Path


def secure_directory(path):
    if os.name != "posix":
        raise OSError("Private Flower state requires a POSIX permission implementation")
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Flower state directory cannot be a symlink")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def secure_state_tree(path):
    path = secure_directory(path)
    for child in path.iterdir():
        if child.is_symlink():
            raise ValueError("Flower state cannot contain symlinks")
        if child.is_dir():
            secure_state_tree(child)
        elif child.is_file():
            child.chmod(0o600)
        else:
            raise ValueError("Flower state contains an unsupported file type")
    return path


def open_private_file(path, flags):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Flower state file cannot be a symlink")
    fd = os.open(path, flags | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
    except OSError:
        os.close(fd)
        raise
    return fd
