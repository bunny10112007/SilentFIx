import ast
import inspect
import sys
import threading
from typing import Optional, Any, Callable


class SilentFixGuard:
    _thread_local = threading.local()
    MAX_DEPTH = 3

    @classmethod
    def is_intercepting(cls) -> bool:
        return getattr(cls._thread_local, 'active', False)

    @classmethod
    def execute_safe(cls, func: Callable, *args: Any, **kwargs: Any) -> Any:
        depth = getattr(cls._thread_local, 'depth', 0)
        if depth >= cls.MAX_DEPTH:
            raise RuntimeError("SilentFix recursion depth exceeded limit.")

        cls._thread_local.active = True
        cls._thread_local.depth = depth + 1
        try:
            return func(*args, **kwargs)
        except Exception as err:
            return cls.silent_remediate(err, func, *args, **kwargs)
        finally:
            cls._thread_local.depth -= 1
            if cls._thread_local.depth == 0:
                cls._thread_local.active = False

    @classmethod
    def silent_remediate(cls, exc: Exception, func: Callable, *args: Any, **kwargs: Any) -> Any:
        # Extract AST frame, construct fallback node, and execute safely
        source = inspect.getsource(func)
        parsed_ast = ast.parse(source)

        # Apply AST patch transformation rule
        transformer = SafeFallbackTransformer(exc)
        modified_ast = transformer.visit(parsed_ast)
        ast.fix_missing_locations(modified_ast)

        compiled_code = compile(modified_ast, filename="<silentfix_gen>", mode="exec")
        local_scope: dict = {}
        exec(compiled_code, func.__globals__, local_scope)
        remediated_func = local_scope.get(func.__name__)

        if callable(remediated_func):
            return remediated_func(*args, **kwargs)
        raise exc


class SafeFallbackTransformer(ast.NodeTransformer):
    def __init__(self, exception: Exception):
        self.exception = exception
        super().__init__()

    def visit_Try(self, node: ast.Try) -> ast.AST:
        self.generic_visit(node)
        return node
