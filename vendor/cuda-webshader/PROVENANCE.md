Compiler and runtime vendored from the user's local cuda-webshader project,
Git revision c272bb782f8458761af2894e8771517f64ecdae6.
The accompanying LICENSE applies to these files. The source modules are used
directly, without changes, so the coastal simulation remains a static website.
Only the compiler/runtime dependency closure is included. Unused compiler-worker
clients, CPU oracle, benchmark helpers, operations wrapper and Three bridge have
been removed from this vendored subset; retained source files are unmodified.
