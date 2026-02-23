#!/usr/bin/env python3
"""
Subtitle Linter for Manim Scripts

Analyzes Manim Python code to detect overlapping subtitles and animation
overflows BEFORE rendering. Uses a lightweight stub module to execute
real Python (loops, conditionals, etc.) without heavy manim imports.

Usage:
    python scripts/lint-subtitles.py <script.py>
    python scripts/lint-subtitles.py <script.py> --verbose

Exit codes:
    0 - No issues found
    1 - Overlapping subtitles or animation overflows detected
    2 - Parse error or invalid input
"""

import ast
import sys
import os
import inspect
import types
import math
import numpy as np
from dataclasses import dataclass, field
from pathlib import Path


# =============================================================================
# Constants
# =============================================================================

OVERFLOW_TOLERANCE = 0.01

_NUMPY_SPECIAL_ATTRS = frozenset([
    '__array_struct__', '__array_interface__', '__array__',
    '__array_priority__', '__array_wrap__', '__array_prepare__',
    '__array_finalize__', '__array_ufunc__', '__array_function__',
])

MANIM_CLASSES = [
    # Mobjects
    'Mobject', 'VMobject', 'VGroup', 'Group', 'VDict',
    'Text', 'Tex', 'MathTex', 'Title', 'Paragraph', 'MarkupText', 'Code',
    'Circle', 'Square', 'Rectangle', 'Triangle', 'Polygon', 'RegularPolygon',
    'Line', 'Arrow', 'DoubleArrow', 'Vector', 'DashedLine', 'TangentLine',
    'Dot', 'SmallDot', 'LabeledDot', 'Annulus', 'AnnularSector', 'Sector', 'Arc',
    'Ellipse', 'Star', 'Cross', 'RoundedRectangle', 'Cutout',
    'Brace', 'BraceLabel', 'BraceBetweenPoints',
    'NumberLine', 'Axes', 'ThreeDAxes', 'NumberPlane', 'PolarPlane', 'ComplexPlane',
    'BarChart', 'Table', 'Matrix', 'DecimalNumber', 'Integer', 'Variable',
    'SurroundingRectangle', 'BackgroundRectangle', 'Underline',
    'ImageMobject', 'SVGMobject',
    'Surface', 'Sphere', 'Torus', 'Cylinder', 'Cone', 'Cube', 'Prism',
    'ParametricFunction', 'FunctionGraph', 'ImplicitFunction',
    'TracedPath', 'StreamLines', 'CurvedArrow', 'CurvedDoubleArrow', 'Elbow',
    'ValueTracker', 'Updater',
    # Animations
    'Animation', 'Wait',
    'Create', 'Uncreate', 'Write', 'Unwrite', 'DrawBorderThenFill',
    'FadeIn', 'FadeOut', 'FadeTransform',
    'GrowFromCenter', 'GrowFromPoint', 'GrowFromEdge', 'SpinInFromNothing',
    'GrowArrow', 'ShowIncreasingSubsets', 'ShowSubmobjectsOneByOne',
    'Transform', 'ReplacementTransform', 'TransformFromCopy',
    'ClockwiseTransform', 'CounterclockwiseTransform',
    'MoveToTarget', 'ApplyMethod', 'ApplyFunction',
    'Indicate', 'FocusOn', 'Flash', 'ShowPassingFlash', 'Circumscribe', 'Wiggle',
    'AnimationGroup', 'Succession', 'LaggedStart', 'LaggedStartMap',
    'Rotate', 'Rotating', 'ApplyPointwiseFunction',
    'MoveAlongPath', 'Homotopy', 'PhaseFlow',
    'ShowCreation', 'ShowPartial',
    'AddTextLetterByLetter', 'RemoveTextLetterByLetter',
    'ScaleInPlace', 'ShrinkToCenter', 'Restore',
]

COLORS = {
    'WHITE': '#FFFFFF', 'BLACK': '#000000',
    'GRAY': '#888888', 'GREY': '#888888',
    'GRAY_A': '#DDDDDD', 'GREY_A': '#DDDDDD', 'GRAY_B': '#BBBBBB', 'GREY_B': '#BBBBBB',
    'GRAY_C': '#888888', 'GREY_C': '#888888', 'GRAY_D': '#444444', 'GREY_D': '#444444',
    'GRAY_E': '#222222', 'GREY_E': '#222222',
    'LIGHT_GRAY': '#BBBBBB', 'LIGHT_GREY': '#BBBBBB',
    'DARK_GRAY': '#444444', 'DARK_GREY': '#444444',
    'RED': '#FC6255', 'RED_A': '#FF8080', 'RED_B': '#FF6666', 'RED_C': '#FC6255',
    'RED_D': '#E65A4C', 'RED_E': '#CF5044',
    'MAROON': '#C55F73', 'ORANGE': '#FF862F',
    'YELLOW': '#FFFF00', 'YELLOW_A': '#FFF1B6', 'YELLOW_B': '#FFEA94',
    'YELLOW_C': '#FFFF00', 'YELLOW_D': '#F4D345', 'YELLOW_E': '#E8C11C',
    'GREEN': '#83C167', 'GREEN_A': '#C9E2AE', 'GREEN_B': '#A6CF8C',
    'GREEN_C': '#83C167', 'GREEN_D': '#77B05D', 'GREEN_E': '#699C52',
    'TEAL': '#5CD0B3', 'TEAL_A': '#ACEAD7', 'TEAL_B': '#76DDC0',
    'TEAL_C': '#5CD0B3', 'TEAL_D': '#55C1A7', 'TEAL_E': '#49A88F',
    'BLUE': '#58C4DD', 'BLUE_A': '#C7E9F1', 'BLUE_B': '#9CDCEB',
    'BLUE_C': '#58C4DD', 'BLUE_D': '#29ABCA', 'BLUE_E': '#1C758A',
    'PURPLE': '#9A72AC', 'PURPLE_A': '#CAA3E8', 'PURPLE_B': '#B189C6',
    'PURPLE_C': '#9A72AC', 'PURPLE_D': '#715582', 'PURPLE_E': '#644172',
    'PINK': '#D147BD', 'LIGHT_PINK': '#DC75CD',
    'GOLD': '#F0AC5F', 'GOLD_A': '#F7C797', 'GOLD_B': '#F9B775',
    'GOLD_C': '#F0AC5F', 'GOLD_D': '#E1A158', 'GOLD_E': '#C78D46',
    'PURE_RED': '#FF0000', 'PURE_GREEN': '#00FF00', 'PURE_BLUE': '#0000FF',
}

DIRECTIONS = {
    'UP': np.array([0, 1, 0]), 'DOWN': np.array([0, -1, 0]),
    'LEFT': np.array([-1, 0, 0]), 'RIGHT': np.array([1, 0, 0]),
    'OUT': np.array([0, 0, 1]), 'IN': np.array([0, 0, -1]),
    'ORIGIN': np.array([0, 0, 0]),
}
DIRECTIONS['UL'] = DIRECTIONS['UP'] + DIRECTIONS['LEFT']
DIRECTIONS['UR'] = DIRECTIONS['UP'] + DIRECTIONS['RIGHT']
DIRECTIONS['DL'] = DIRECTIONS['DOWN'] + DIRECTIONS['LEFT']
DIRECTIONS['DR'] = DIRECTIONS['DOWN'] + DIRECTIONS['RIGHT']

RATE_FUNCS = [
    'linear', 'smooth', 'rush_into', 'rush_from', 'slow_into',
    'double_smooth', 'there_and_back', 'there_and_back_with_pause',
    'running_start', 'not_quite_there', 'wiggle', 'squish_rate_func',
    'lingering', 'exponential_decay',
]


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class Subtitle:
    """A subtitle with timing information."""
    index: int
    start: float
    end: float
    text: str
    line_number: int
    scene_name: str


@dataclass
class SubtitleCollector:
    """Collects subtitles and tracks timing during scene execution."""
    subtitles: list[Subtitle] = field(default_factory=list)
    overflows: list[dict] = field(default_factory=list)
    current_time: float = 0.0
    subtitle_index: int = 0
    scene_name: str = ""
    verbose: bool = False
    _active_end: float = 0.0
    _active_line: int = 0

    def add_subtitle(self, text: str, duration: float, line_number: int):
        """Record a subtitle at the current time."""
        subtitle = Subtitle(
            index=self.subtitle_index,
            start=self.current_time,
            end=self.current_time + duration,
            text=str(text)[:50] if text else "<empty>",
            line_number=line_number,
            scene_name=self.scene_name
        )
        self.subtitles.append(subtitle)
        self.subtitle_index += 1
        self._active_end = subtitle.end
        self._active_line = line_number

        if self.verbose:
            print(f"  [{subtitle.index}] {subtitle.start:.2f}s-{subtitle.end:.2f}s: \"{subtitle.text}\"")

    def advance_time(self, duration: float, line_number: int, check_overflow: bool = False):
        """Advance scene time, optionally checking for animation overflow."""
        if duration < 0:
            duration = 0

        end_time = self.current_time + duration

        if check_overflow and self._active_end > self.current_time:
            if end_time > self._active_end + OVERFLOW_TOLERANCE:
                self.overflows.append({
                    'scene': self.scene_name,
                    'line': line_number,
                    'subtitle_line': self._active_line,
                    'subtitle_end': self._active_end,
                    'animation_end': end_time,
                    'overflow': end_time - self._active_end
                })

        self.current_time = end_time

        if self._active_end > 0 and self.current_time >= self._active_end:
            self._active_end = 0.0
            self._active_line = 0

        if self.verbose:
            print(f"  time += {duration:.2f}s -> {self.current_time:.2f}s")


# =============================================================================
# Stub Manim Module
# =============================================================================

class DummyMobject:
    """Absorbs any method/attribute access for manim objects."""
    run_time = 1.0

    def __init__(self, *args, **kwargs):
        if 'run_time' in kwargs:
            self.run_time = kwargs['run_time']
        self._args = []
        for arg in args:
            if isinstance(arg, DummyMobject):
                self._args.append(arg)
            elif isinstance(arg, (list, tuple)):
                self._args.extend(arg)
            else:
                self._args.append(DummyMobject())

    def add(self, *mobjects):
        for mobject in mobjects:
            if isinstance(mobject, DummyMobject):
                self._args.append(mobject)
            elif isinstance(mobject, (list, tuple)):
                self._args.extend(mobject)
            else:
                self._args.append(DummyMobject())
        return self

    def __getattr__(self, name):
        if name in _NUMPY_SPECIAL_ATTRS:
            raise AttributeError(name)
        if name.startswith('get_'):
            return lambda *a, **kw: np.array([0.0, 0.0, 0.0])
        return DummyMobject()

    def __call__(self, *args, **kwargs):
        return DummyMobject(*args, **kwargs)

    def __iter__(self):
        return iter(self._args) if self._args else iter([])

    def __len__(self):
        return len(self._args) if self._args else 0

    def __getitem__(self, key):
        if self._args and isinstance(key, int) and 0 <= key < len(self._args):
            item = self._args[key]
            if isinstance(item, DummyMobject):
                return item
        return DummyMobject()

    def __setitem__(self, key, value):
        pass

    def __bool__(self):
        return True

    def __repr__(self):
        return "DummyMobject()"

    def __array__(self, dtype=None):
        return np.array([0.0, 0.0, 0.0], dtype=dtype)

    def _binop(self, other):
        if hasattr(other, '__iter__') and not isinstance(other, (str, DummyMobject)):
            return other
        return DummyMobject()

    __add__ = __radd__ = __sub__ = __rsub__ = lambda self, other: self._binop(other)
    __mul__ = __rmul__ = lambda self, other: self._binop(other)
    __neg__ = __pos__ = lambda self: DummyMobject()

    def copy(self):
        return DummyMobject()

    @property
    def animate(self):
        return DummyMobject()


def create_stub_module(collector: SubtitleCollector):
    """Create a lightweight stub manim module."""

    class InstrumentedScene:
        def __init__(self, *args, **kwargs):
            self._mobjects = []

        @staticmethod
        def _resolve_duration(run_time, animations=()):
            """Resolve animation duration like Scene.play."""
            if isinstance(run_time, (int, float)):
                return float(run_time)

            duration = 1.0
            for anim in animations or ():
                if hasattr(anim, 'run_time') and isinstance(anim.run_time, (int, float)):
                    duration = max(duration, float(anim.run_time))
            return duration

        def add_subcaption(self, content: str, duration: float = 1.0, offset: float = 0.0):
            frame = inspect.currentframe()
            line = frame.f_back.f_lineno if frame and frame.f_back else 0
            collector.add_subtitle(content, duration, line)

        def play(self, *args, subcaption: str = None, subcaption_duration: float = None,
                 subcaption_offset: float = 0.0, run_time: float = None, **kwargs):
            frame = inspect.currentframe()
            line = frame.f_back.f_lineno if frame and frame.f_back else 0

            duration = self._resolve_duration(run_time, args)

            if subcaption:
                sub_dur = subcaption_duration if subcaption_duration is not None else duration
                collector.add_subtitle(subcaption, sub_dur, line)

            collector.advance_time(duration, line, check_overflow=True)

        def wait(self, duration: float = 1.0, **kwargs):
            frame = inspect.currentframe()
            line = frame.f_back.f_lineno if frame and frame.f_back else 0
            collector.advance_time(duration, line)

        def move_camera(self, *args, run_time: float = None, **kwargs):
            """
            Approximate ThreeDScene.move_camera timing.

            In ManimCE, move_camera(...) builds camera animations and calls
            self.play(..., **kwargs). We model it as a timed animation so
            subtitle overlap checks stay accurate for 3D scenes.
            """
            frame = inspect.currentframe()
            line = frame.f_back.f_lineno if frame and frame.f_back else 0
            added_anims = kwargs.get('added_anims', ())
            duration = self._resolve_duration(run_time, added_anims)

            subcaption = kwargs.get('subcaption')
            subcaption_duration = kwargs.get('subcaption_duration')
            if subcaption:
                sub_dur = subcaption_duration if subcaption_duration is not None else duration
                collector.add_subtitle(subcaption, sub_dur, line)

            collector.advance_time(duration, line, check_overflow=True)

        def add(self, *mobjects):
            self._mobjects.extend(mobjects)

        def remove(self, *mobjects):
            pass

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

    stub = StubModule('manim')

    for scene_type in ['Scene', 'ThreeDScene', 'MovingCameraScene', 'ZoomedScene']:
        setattr(stub, scene_type, InstrumentedScene)

    for cls_name in MANIM_CLASSES:
        setattr(stub, cls_name, DummyMobject)

    for rf in RATE_FUNCS:
        setattr(stub, rf, lambda t: t)

    for name, value in COLORS.items():
        setattr(stub, name, value)

    for name, value in DIRECTIONS.items():
        setattr(stub, name, value)

    stub.PI = math.pi
    stub.TAU = 2 * math.pi
    stub.DEGREES = math.pi / 180
    stub.BOLD = 'BOLD'
    stub.ITALIC = 'ITALIC'
    stub.NORMAL = 'NORMAL'

    class ConfigStub:
        frame_width = 14.222
        frame_height = 8.0
        pixel_width = 1920
        pixel_height = 1080
        frame_rate = 60
        background_color = '#000000'

        def __getattr__(self, name):
            return None

        def __setattr__(self, name, value):
            object.__setattr__(self, name, value)

    stub.config = ConfigStub()
    stub.always_redraw = lambda func: func()
    stub.always_shift = lambda mob, direction: mob
    stub.interpolate = lambda a, b, t: a + (b - a) * t
    stub.interpolate_color = lambda c1, c2, t: c1
    stub.np = np

    stub.__all__ = (
        MANIM_CLASSES + RATE_FUNCS +
        list(COLORS.keys()) + list(DIRECTIONS.keys()) +
        ['Scene', 'ThreeDScene', 'MovingCameraScene', 'ZoomedScene',
         'PI', 'TAU', 'DEGREES', 'BOLD', 'ITALIC', 'NORMAL',
         'config', 'always_redraw', 'always_shift', 'interpolate', 'interpolate_color', 'np']
    )

    return stub


# =============================================================================
# Linting
# =============================================================================

def find_scene_names(source: str, filepath: str) -> list[str]:
    """Find Scene subclass names via AST."""
    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        return []

    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                base_name = base.id if isinstance(base, ast.Name) else getattr(base, 'attr', '')
                if 'Scene' in base_name:
                    names.append(node.name)
                    break
    return names


def find_overlaps(subtitles: list[Subtitle]) -> list[tuple[Subtitle, Subtitle]]:
    """Find overlapping subtitle pairs."""
    overlaps = []
    sorted_subs = sorted(subtitles, key=lambda s: s.start)
    for i in range(len(sorted_subs) - 1):
        curr, next_sub = sorted_subs[i], sorted_subs[i + 1]
        if curr.end > next_sub.start + OVERFLOW_TOLERANCE:
            overlaps.append((curr, next_sub))
    return overlaps


def lint_file(filepath: str, verbose: bool = False) -> int:
    """Lint a Manim script for subtitle issues. Returns exit code."""
    filepath = os.path.abspath(filepath)
    module_name = Path(filepath).stem

    try:
        with open(filepath, 'r') as f:
            source = f.read()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2

    try:
        ast.parse(source, filename=filepath)
    except SyntaxError as e:
        print(f"Syntax error: {e}", file=sys.stderr)
        return 2

    try:
        code = compile(source, filepath, 'exec')
    except SyntaxError as e:
        print(f"Syntax error: {e}", file=sys.stderr)
        return 2

    scene_names = find_scene_names(source, filepath)
    if not scene_names:
        print("Warning: No Scene subclasses found", file=sys.stderr)
        return 0

    scenes = {}
    all_overflows = []
    all_scene_spills = []
    warnings = []

    for scene_name in scene_names:
        collector = SubtitleCollector(verbose=verbose, scene_name=scene_name)

        if verbose:
            print(f"[Scene] {scene_name}")

        stub = create_stub_module(collector)
        patched_modules = ['manim', 'manim.constants', 'manim.mobject', 'manim.animation', 'manim.scene', 'manim.utils']
        original_modules = {name: sys.modules.get(name) for name in patched_modules}

        for module_name_to_patch in patched_modules:
            sys.modules[module_name_to_patch] = stub

        module_dir = os.path.dirname(filepath)
        path_added = False
        if module_dir not in sys.path:
            sys.path.insert(0, module_dir)
            path_added = True

        try:
            module_globals = {'__name__': module_name, '__file__': filepath, '__builtins__': __builtins__}
            exec(code, module_globals)

            if scene_name in module_globals:
                instance = module_globals[scene_name]()
                if hasattr(instance, 'construct'):
                    instance.construct()

        except Exception as e:
            warnings.append(f"Error in {scene_name}.construct(): {e}")
            if verbose:
                import traceback
                traceback.print_exc()

        finally:
            for module_name_to_restore, module_value in original_modules.items():
                if module_value is None:
                    sys.modules.pop(module_name_to_restore, None)
                else:
                    sys.modules[module_name_to_restore] = module_value
            if path_added:
                try:
                    sys.path.remove(module_dir)
                except ValueError:
                    pass

        scenes[scene_name] = collector.subtitles
        all_overflows.extend(collector.overflows)
        scene_end = collector.current_time
        for subtitle in collector.subtitles:
            if subtitle.end > scene_end + OVERFLOW_TOLERANCE:
                all_scene_spills.append({
                    'scene': scene_name,
                    'line': subtitle.line_number,
                    'scene_end': scene_end,
                    'subtitle_end': subtitle.end,
                    'spill': subtitle.end - scene_end,
                    'text': subtitle.text
                })

    for w in warnings:
        print(f"Warning: {w}", file=sys.stderr)

    # Find overlaps
    all_overlaps = []
    for scene_name, subtitles in scenes.items():
        for curr, next_sub in find_overlaps(subtitles):
            all_overlaps.append({'scene': scene_name, 'current': curr, 'next': next_sub,
                                 'overlap': curr.end - next_sub.start})

    # Report results
    if not all_overlaps and not all_overflows and not all_scene_spills:
        total = sum(len(subs) for subs in scenes.values())
        print(f"No issues found ({total} subtitles in {len(scenes)} scenes)")
        return 0

    if all_overlaps:
        print(f"Found {len(all_overlaps)} overlapping subtitle(s):\n")
        for issue in all_overlaps:
            curr, next_sub = issue['current'], issue['next']
            print(f"  Scene: {issue['scene']}")
            print(f"  Line {curr.line_number}: ends at {curr.end:.2f}s - \"{curr.text}\"")
            print(f"  Line {next_sub.line_number}: starts at {next_sub.start:.2f}s - \"{next_sub.text}\"")
            print(f"  Overlap: {issue['overlap']:.2f}s\n")

    if all_overflows:
        print(f"Found {len(all_overflows)} animation overflow(s):\n")
        for o in all_overflows:
            print(f"  Scene: {o['scene']}")
            print(f"  Line {o['subtitle_line']}: subtitle ends at {o['subtitle_end']:.2f}s")
            print(f"  Line {o['line']}: animation ends at {o['animation_end']:.2f}s")
            print(f"  Overflow: {o['overflow']:.2f}s\n")

    if all_scene_spills:
        print(f"Found {len(all_scene_spills)} scene-boundary subtitle spill(s):\n")
        for s in all_scene_spills:
            print(f"  Scene: {s['scene']}")
            print(f"  Line {s['line']}: subtitle ends at {s['subtitle_end']:.2f}s - \"{s['text']}\"")
            print(f"  Scene ends at {s['scene_end']:.2f}s")
            print(f"  Spill: {s['spill']:.2f}s\n")

    print("Fix: Ensure each subtitle is fully covered before scene end (e.g., add the remaining wait).")
    return 1


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Lint Manim scripts for subtitle issues')
    parser.add_argument('file', help='Manim script to lint')
    parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed timing')
    args = parser.parse_args()

    print(f"Checking subtitles in: {args.file}\n")
    sys.exit(lint_file(args.file, verbose=args.verbose))


if __name__ == '__main__':
    main()
