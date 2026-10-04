# Shader capture fixtures

Tiny `--shader-replay` captures used by the `shader_*` ctests. Each directory has the layout the
emulator writes with `--shader-capture-dir` (see `src/graphics/shader/shaderCapture.h`) and is
assembled from the `.s` file next to it:

```
tools/shader/asm2capture.py tests/data/shader_capture/store_ok.s \
    tests/data/shader_capture/store_ok --user-data 0x10000000,0x0,0x100,0x30000000 --hash 0xa1
```

| fixture | expected replay |
|---|---|
| `store_ok` | `REPLAY OK` |
| `fract_f64` | `REPLAY OK` (`v_fract_f64`, VOP1 and VOP3 with source modifiers) |
| `cmp_i64` | `REPLAY OK` (every `v_cmp` and `v_cmpx` 64-bit integer compare, signed and unsigned, VOPC and VOP3) |
| `gpu_selected_store` | known failure: `GPU-selected access requires a raw DWORD x2/x3/x4 load` (exit 65) |

`fract_f64` and `cmp_i64` are assembled the same way:

```
tools/shader/asm2capture.py tests/data/shader_capture/fract_f64.s \
    tests/data/shader_capture/fract_f64 --user-data 0x10000000,0x0,0x1000,0x30000000 --hash 0xf64
tools/shader/asm2capture.py tests/data/shader_capture/cmp_i64.s \
    tests/data/shader_capture/cmp_i64 --user-data 0x10000000,0x0,0x1000,0x30000000 --hash 0xc164
```

The tests copy these into the build directory first, because replaying writes `replay.log` and
`out.spv` next to the capture.
