#!/usr/bin/env python3
"""
Subtitle linter for Manim scripts.

Runs scenes with a lightweight Manim stub (no render) and reports:
- overlapping subtitles
- animation overflow beyond subtitle duration
"""

import argparse
import ast
import builtins
from dataclasses import dataclass, field
import inspect
import keyword
import math
import os
from pathlib import Path
import sys
import types

import numpy as np

OVERFLOW_TOLERANCE = 0.01
PATCHED_MANIM_MODULES = (
    "manim",
    "manim.constants",
    "manim.mobject",
    "manim.animation",
    "manim.scene",
    "manim.utils",
)
SCENE_TYPES = ("Scene", "ThreeDScene", "MovingCameraScene", "ZoomedScene")
RATE_FUNCS = (
    "linear",
    "smooth",
    "rush_into",
    "rush_from",
    "slow_into",
    "double_smooth",
    "there_and_back",
    "there_and_back_with_pause",
    "running_start",
    "not_quite_there",
    "wiggle",
    "squish_rate_func",
    "lingering",
    "exponential_decay",
)

VECTOR_CONSTANTS = {
    "UP": np.array([0.0, 1.0, 0.0]),
    "DOWN": np.array([0.0, -1.0, 0.0]),
    "LEFT": np.array([-1.0, 0.0, 0.0]),
    "RIGHT": np.array([1.0, 0.0, 0.0]),
    "OUT": np.array([0.0, 0.0, 1.0]),
    "IN": np.array([0.0, 0.0, -1.0]),
    "ORIGIN": np.array([0.0, 0.0, 0.0]),
}
VECTOR_CONSTANTS["UL"] = VECTOR_CONSTANTS["UP"] + VECTOR_CONSTANTS["LEFT"]
VECTOR_CONSTANTS["UR"] = VECTOR_CONSTANTS["UP"] + VECTOR_CONSTANTS["RIGHT"]
VECTOR_CONSTANTS["DL"] = VECTOR_CONSTANTS["DOWN"] + VECTOR_CONSTANTS["LEFT"]
VECTOR_CONSTANTS["DR"] = VECTOR_CONSTANTS["DOWN"] + VECTOR_CONSTANTS["RIGHT"]

BASE_EXPORTS = {
    *SCENE_TYPES,
    *RATE_FUNCS,
    *VECTOR_CONSTANTS.keys(),
    "PI",
    "TAU",
    "DEGREES",
    "BOLD",
    "ITALIC",
    "NORMAL",
    "config",
    "np",
    "always_redraw",
    "always_shift",
    "interpolate",
    "interpolate_color",
}


@dataclass
class Subtitle:
    index: int
    start: float
    end: float
    text: str
    line_number: int
    scene_name: str


@dataclass
class SubtitleCollector:
    subtitles: list[Subtitle] = field(default_factory=list)
    overflows: list[dict] = field(default_factory=list)
    current_time: float = 0.0
    subtitle_index: int = 0
    scene_name: str = ""
    verbose: bool = False
    _active_end: float = 0.0
    _active_line: int = 0

    def add_subtitle(self, text: str, duration: float, line_number: int) -> None:
        try:
            dur = max(0.0, float(duration))
        except (TypeError, ValueError):
            dur = 1.0

        sub = Subtitle(
            index=self.subtitle_index,
            start=self.current_time,
            end=self.current_time + dur,
            text=str(text)[:50] if text else "<empty>",
            line_number=line_number,
            scene_name=self.scene_name,
        )
        self.subtitles.append(sub)
        self.subtitle_index += 1
        self._active_end = sub.end
        self._active_line = line_number

        if self.verbose:
            print(f'  [{sub.index}] {sub.start:.2f}s-{sub.end:.2f}s: "{sub.text}"')

    def advance_time(self, duration: float, line_number: int, check_overflow: bool = False) -> None:
        try:
            step = max(0.0, float(duration))
        except (TypeError, ValueError):
            step = 0.0

        end_time = self.current_time + step

        if check_overflow and self._active_end > self.current_time:
            if end_time > self._active_end + OVERFLOW_TOLERANCE:
                self.overflows.append(
                    {
                        "scene": self.scene_name,
                        "line": line_number,
                        "subtitle_line": self._active_line,
                        "subtitle_end": self._active_end,
                        "animation_end": end_time,
                        "overflow": end_time - self._active_end,
                    }
                )

        self.current_time = end_time

        if self._active_end > 0 and self.current_time >= self._active_end:
            self._active_end = 0.0
            self._active_line = 0

        if self.verbose:
            print(f"  time += {step:.2f}s -> {self.current_time:.2f}s")


class DummyMobject:
    run_time = 1.0

    def __init__(self, *args, **kwargs):
        if "run_time" in kwargs:
            self.run_time = kwargs["run_time"]
        self._args = []
        for arg in args:
            if isinstance(arg, DummyMobject):
                self._args.append(arg)
            elif isinstance(arg, (list, tuple)):
                self._args.extend(arg)
            else:
                self._args.append(DummyMobject())

    def __getattr__(self, name):
        if name.startswith("__array"):
            raise AttributeError(name)
        if name.startswith("get_"):
            return lambda *a, **k: np.array([0.0, 0.0, 0.0])
        return DummyMobject()

    def __call__(self, *args, **kwargs):
        return DummyMobject(*args, **kwargs)

    def __iter__(self):
        return iter(self._args)

    def __len__(self):
        return len(self._args)

    def __getitem__(self, key):
        if isinstance(key, int) and 0 <= key < len(self._args):
            item = self._args[key]
            if isinstance(item, DummyMobject):
                return item
        return DummyMobject()

    def __bool__(self):
        return True

    def __array__(self, dtype=None):
        return np.array([0.0, 0.0, 0.0], dtype=dtype)

    def _op(self, other):
        if isinstance(other, (np.ndarray, list, tuple)):
            return other
        return DummyMobject()

    __add__ = __radd__ = __sub__ = __rsub__ = lambda self, other: self._op(other)
    __mul__ = __rmul__ = __truediv__ = __rtruediv__ = lambda self, other: self._op(other)
    __neg__ = __pos__ = lambda self: DummyMobject()

    def copy(self):
        return DummyMobject()

    @property
    def animate(self):
        return DummyMobject()


def caller_line() -> int:
    frame = inspect.currentframe()
    caller = frame.f_back.f_back if frame and frame.f_back else None
    return caller.f_lineno if caller else 0


def resolve_duration(run_time, animations=()) -> float:
    if isinstance(run_time, (int, float)):
        return max(0.0, float(run_time))

    duration = 1.0
    for anim in animations or ():
        candidate = getattr(anim, "run_time", None)
        if isinstance(candidate, (int, float)):
            duration = max(duration, float(candidate))
    return max(0.0, duration)


def find_scene_names(tree: ast.AST) -> list[str]:
    scenes = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for base in node.bases:
            if isinstance(base, ast.Name):
                name = base.id
            elif isinstance(base, ast.Attribute):
                name = base.attr
            else:
                name = ""
            if "Scene" in name:
                scenes.append((node.lineno, node.name))
                break
    return [name for _, name in sorted(scenes)]


def collect_stub_exports(tree: ast.AST) -> set[str]:
    exports = set(BASE_EXPORTS)

    has_star_import = False
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        module_name = node.module or ""
        if module_name != "manim" and not module_name.startswith("manim."):
            continue
        for alias in node.names:
            if alias.name == "*":
                has_star_import = True
            else:
                exports.add(alias.name)

    if not has_star_import:
        return exports

    builtin_names = set(dir(builtins))
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            name = node.id
            if name.startswith("_") or keyword.iskeyword(name) or name in builtin_names:
                continue
            exports.add(name)

    return exports


def create_stub_module(collector: SubtitleCollector, exported_names: set[str]):
    class InstrumentedScene:
        def __init__(self, *args, **kwargs):
            self._mobjects = []

        def add_subcaption(self, content: str, duration: float = 1.0, offset: float = 0.0):
            collector.add_subtitle(content, duration, caller_line())

        def play(
            self,
            *args,
            subcaption: str = None,
            subcaption_duration: float = None,
            subcaption_offset: float = 0.0,
            run_time: float = None,
            **kwargs,
        ):
            line = caller_line()
            duration = resolve_duration(run_time, args)

            if subcaption:
                sub_dur = subcaption_duration if subcaption_duration is not None else duration
                collector.add_subtitle(subcaption, sub_dur, line)

            collector.advance_time(duration, line, check_overflow=True)

        def wait(self, duration: float = 1.0, **kwargs):
            collector.advance_time(duration, caller_line())

        def move_camera(self, *args, run_time: float = None, **kwargs):
            line = caller_line()
            duration = resolve_duration(run_time, kwargs.get("added_anims", ()))
            subcaption = kwargs.get("subcaption")
            if subcaption:
                sub_dur = kwargs.get("subcaption_duration")
                collector.add_subtitle(subcaption, duration if sub_dur is None else sub_dur, line)
            collector.advance_time(duration, line, check_overflow=True)

        def add(self, *mobjects):
            self._mobjects.extend(mobjects)

        def remove(self, *mobjects):
            return None

        def clear(self):
            self._mobjects = []

        @property
        def mobjects(self):
            return self._mobjects

        @property
        def camera(self):
            return DummyMobject()

        def __getattr__(self, name):
            return lambda *args, **kwargs: DummyMobject()

    class StubModule(types.ModuleType):
        def __getattr__(self, name):
            return DummyMobject()

    class ConfigStub:
        frame_width = 14.222
        frame_height = 8.0
        pixel_width = 1920
        pixel_height = 1080
        frame_rate = 60
        background_color = "#000000"

        def __getattr__(self, name):
            return None

    stub = StubModule("manim")

    for scene_type in SCENE_TYPES:
        setattr(stub, scene_type, InstrumentedScene)

    for rate_func in RATE_FUNCS:
        setattr(stub, rate_func, lambda t: t)

    for name, value in VECTOR_CONSTANTS.items():
        setattr(stub, name, value)

    stub.PI = math.pi
    stub.TAU = 2 * math.pi
    stub.DEGREES = math.pi / 180
    stub.BOLD = "BOLD"
    stub.ITALIC = "ITALIC"
    stub.NORMAL = "NORMAL"
    stub.config = ConfigStub()
    stub.np = np
    stub.always_redraw = lambda fn: fn()
    stub.always_shift = lambda mob, direction: mob
    stub.interpolate = lambda a, b, t: a + (b - a) * t
    stub.interpolate_color = lambda c1, c2, t: c1

    for name in sorted(exported_names):
        if name in stub.__dict__:
            continue
        setattr(stub, name, 1.0 if name.isupper() else DummyMobject)

    stub.__all__ = sorted({*BASE_EXPORTS, *exported_names})
    return stub


def find_overlaps(subtitles: list[Subtitle]) -> list[tuple[Subtitle, Subtitle]]:
    overlaps = []
    sorted_subs = sorted(subtitles, key=lambda s: s.start)
    for idx in range(len(sorted_subs) - 1):
        curr, next_sub = sorted_subs[idx], sorted_subs[idx + 1]
        if curr.end > next_sub.start + OVERFLOW_TOLERANCE:
            overlaps.append((curr, next_sub))
    return overlaps


def lint_file(filepath: str, verbose: bool = False) -> int:
    filepath = os.path.abspath(filepath)
    module_name = Path(filepath).stem

    try:
        source = Path(filepath).read_text()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    try:
        tree = ast.parse(source, filename=filepath)
        code = compile(tree, filepath, "exec")
    except SyntaxError as exc:
        print(f"Syntax error: {exc}", file=sys.stderr)
        return 2

    scene_names = find_scene_names(tree)
    if not scene_names:
        print("Warning: No Scene subclasses found", file=sys.stderr)
        return 0

    exported_names = collect_stub_exports(tree)
    scenes: dict[str, list[Subtitle]] = {}
    all_overflows = []
    warnings = []

    module_dir = os.path.dirname(filepath)

    for scene_name in scene_names:
        collector = SubtitleCollector(scene_name=scene_name, verbose=verbose)
        if verbose:
            print(f"[Scene] {scene_name}")

        stub = create_stub_module(collector, exported_names)
        original_modules = {name: sys.modules.get(name) for name in PATCHED_MANIM_MODULES}
        for patch_name in PATCHED_MANIM_MODULES:
            sys.modules[patch_name] = stub

        path_added = False
        if module_dir not in sys.path:
            sys.path.insert(0, module_dir)
            path_added = True

        try:
            module_globals = {
                "__name__": module_name,
                "__file__": filepath,
                "__builtins__": __builtins__,
            }
            exec(code, module_globals)

            scene_cls = module_globals.get(scene_name)
            if scene_cls is None:
                warnings.append(f"Scene class not found at runtime: {scene_name}")
            else:
                scene = scene_cls()
                if hasattr(scene, "construct"):
                    scene.construct()
        except Exception as exc:
            warnings.append(f"Error in {scene_name}.construct(): {exc}")
            if verbose:
                import traceback

                traceback.print_exc()
        finally:
            for restore_name, module_value in original_modules.items():
                if module_value is None:
                    sys.modules.pop(restore_name, None)
                else:
                    sys.modules[restore_name] = module_value
            if path_added:
                try:
                    sys.path.remove(module_dir)
                except ValueError:
                    pass

        scenes[scene_name] = collector.subtitles
        all_overflows.extend(collector.overflows)

    for warning in warnings:
        print(f"Warning: {warning}", file=sys.stderr)

    all_overlaps = []
    for scene_name, subtitles in scenes.items():
        for current, next_sub in find_overlaps(subtitles):
            all_overlaps.append(
                {
                    "scene": scene_name,
                    "current": current,
                    "next": next_sub,
                    "overlap": current.end - next_sub.start,
                }
            )

    if not all_overlaps and not all_overflows:
        total = sum(len(subs) for subs in scenes.values())
        print(f"No issues found ({total} subtitles in {len(scenes)} scenes)")
        return 0

    if all_overlaps:
        print(f"Found {len(all_overlaps)} overlapping subtitle(s):\n")
        for issue in all_overlaps:
            curr, next_sub = issue["current"], issue["next"]
            print(f"  Scene: {issue['scene']}")
            print(f'  Line {curr.line_number}: ends at {curr.end:.2f}s - "{curr.text}"')
            print(f'  Line {next_sub.line_number}: starts at {next_sub.start:.2f}s - "{next_sub.text}"')
            print(f"  Overlap: {issue['overlap']:.2f}s\n")

    if all_overflows:
        print(f"Found {len(all_overflows)} animation overflow(s):\n")
        for overflow in all_overflows:
            print(f"  Scene: {overflow['scene']}")
            print(f"  Line {overflow['subtitle_line']}: subtitle ends at {overflow['subtitle_end']:.2f}s")
            print(f"  Line {overflow['line']}: animation ends at {overflow['animation_end']:.2f}s")
            print(f"  Overflow: {overflow['overflow']:.2f}s\n")

    print("Fix: adjust subtitle durations or waits so each animation stays covered.")
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Lint Manim scripts for subtitle timing issues")
    parser.add_argument("file", help="Manim script to lint")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show detailed timing")
    args = parser.parse_args()

    print(f"Checking subtitles in: {args.file}\n")
    sys.exit(lint_file(args.file, verbose=args.verbose))


if __name__ == "__main__":
    main()
