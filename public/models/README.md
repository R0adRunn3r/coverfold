# AI upscaling models

The upscaling networks the app uses, in ncnn format. The app converts them to ONNX in the browser when they are used.

| Files | Name in the app | Origin | Licence |
|---|---|---|---|
| `realesrgan-x4plus.param/.bin` | Standard | Real-ESRGAN x4plus, Xintao Wang / Tencent ARC | BSD 3-Clause, see `LICENSE-Real-ESRGAN.txt` |
| `realesr-general-x4v3.param/.bin` | Lite | Real-ESRGAN general x4v3, Xintao Wang / Tencent ARC | BSD 3-Clause, see `LICENSE-Real-ESRGAN.txt` |
| `realesrgan-x4plus-anime.param/.bin` | Digital Art | Real-ESRGAN x4plus anime 6B, Xintao Wang / Tencent ARC | BSD 3-Clause, see `LICENSE-Real-ESRGAN.txt` |
| `ultramix-balanced-4x.param/.bin` | Ultramix | 4x-UltraMix Balanced by [Kim2091](https://huggingface.co/Kim2091/UltraSharp) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): non-commercial use only |

Ultramix is Kim2091's network converted to ncnn format, with no other change. It may not be used for commercial purposes, and redistributions must keep the same licence and this credit.

Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN
