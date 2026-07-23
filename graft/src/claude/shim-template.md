# src/claude/shim-template.ts

Generates shims to dynamically locate and execute the correct version of the @nanonets/graft package's entry points, ensuring compatibility across different installation methods.

- shim · function · L16-L60 — Generates a script that dynamically locates and executes a specified entry file from the installed graft package, ensuring compatibility across various installation methods.
- statuslineShim · function · L62-L62 — Creates a shim for the statusline entry of the graft package, facilitating its execution in a consistent manner.
- hooksShim · function · L63-L63 — Creates a shim for the hooks entry of the graft package, enabling its execution with command-line arguments.
