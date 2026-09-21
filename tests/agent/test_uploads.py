import errno
import os

import pytest

from agent.core.uploads import RESERVE, UploadError, UploadStore

GIB = 1024 ** 3


def _store(tmp_path, free=100 * GIB, **kw):
    return UploadStore(tmp_path / "uploads", free_bytes=lambda: free, **kw)


def test_a_file_that_will_not_fit_is_refused_before_any_byte(tmp_path):
    store = _store(tmp_path, free=5 * GIB)
    with pytest.raises(UploadError) as e:
        store.start("blog", "data/big.zip", 5 * GIB - RESERVE + 1, "fp", False)
    assert e.value.code == "not_enough_space"
    assert e.value.extra["free_bytes"] == 5 * GIB
    assert not (tmp_path / "uploads").exists() or not os.listdir(tmp_path / "uploads")


def test_chunks_append_and_the_offset_is_the_bytes_held(tmp_path):
    store = _store(tmp_path)
    up = store.start("blog", "a.bin", 6, "fp", False)
    assert store.append(up.id, 0, b"abc").offset == 3
    assert store.append(up.id, 3, b"def").offset == 6


def test_a_wrong_offset_is_refused_with_the_real_one(tmp_path):
    # A client that resent a chunk after a dropped reply would otherwise
    # write it twice.
    store = _store(tmp_path)
    up = store.start("blog", "a.bin", 6, "fp", False)
    store.append(up.id, 0, b"abc")
    with pytest.raises(UploadError) as e:
        store.append(up.id, 0, b"abc")
    assert (e.value.code, e.value.extra["offset"]) == ("offset_mismatch", 3)


def test_more_bytes_than_declared_are_refused(tmp_path):
    store = _store(tmp_path)
    up = store.start("blog", "a.bin", 2, "fp", False)
    with pytest.raises(UploadError) as e:
        store.append(up.id, 0, b"abc")
    assert e.value.code == "too_much_data"


def test_a_disk_full_mid_chunk_rolls_back_to_the_chunk_start(tmp_path):
    class HalfWriter:
        def __init__(self, f):
            self._f = f

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self._f.close()

        def seek(self, *a):
            return self._f.seek(*a)

        def write(self, data):
            self._f.write(data[: len(data) // 2])
            self._f.flush()
            raise OSError(errno.ENOSPC, "No space left on device")

        def flush(self):
            self._f.flush()

        def fileno(self):
            return self._f.fileno()

    store = _store(tmp_path)
    up = store.start("blog", "a.bin", 10, "fp", False)
    store.append(up.id, 0, b"abcd")
    failing = _store(tmp_path, opener=lambda p, m: HalfWriter(open(p, m)))
    with pytest.raises(UploadError) as e:
        failing.append(up.id, 4, b"efgh")
    assert (e.value.code, e.value.extra["offset"]) == ("disk_full", 4)
    assert store.get(up.id).offset == 4


def test_finish_moves_the_file_into_place_and_forgets_the_upload(tmp_path):
    store = _store(tmp_path)
    up = store.start("blog", "data/a.bin", 3, "fp", False)
    store.append(up.id, 0, b"abc")
    target = tmp_path / "projects" / "blog" / "data" / "a.bin"
    store.finish(up.id, target)
    assert target.read_bytes() == b"abc"
    assert store.list_for("blog") == []


def test_an_unfinished_upload_cannot_be_finished(tmp_path):
    store = _store(tmp_path)
    up = store.start("blog", "a.bin", 3, "fp", False)
    with pytest.raises(UploadError) as e:
        store.finish(up.id, tmp_path / "a.bin")
    assert e.value.code == "incomplete"


def test_an_upload_id_cannot_name_a_path(tmp_path):
    with pytest.raises(UploadError) as e:
        _store(tmp_path).get("../../etc")
    assert e.value.code == "upload_not_found"


def test_uploads_untouched_for_a_week_are_swept(tmp_path):
    now = [1_000_000.0]
    store = _store(tmp_path, clock=lambda: now[0])
    old = store.start("blog", "a.bin", 3, "fp", False)
    os.utime(tmp_path / "uploads" / old.id / "data", (now[0], now[0]))
    now[0] += 7 * 24 * 3600 + 1
    fresh = store.start("blog", "b.bin", 3, "fp", False)
    os.utime(tmp_path / "uploads" / fresh.id / "data", (now[0], now[0]))
    store.sweep()
    assert [u.id for u in store.list_for("blog")] == [fresh.id]
