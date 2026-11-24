"""
Sitecustomize hook to load ast_interceptor prior to standard module loading
as specified in SilentFix Core Audit & Blueprint (Section 4).
"""
try:
    import ast_interceptor
except ImportError:
    pass
