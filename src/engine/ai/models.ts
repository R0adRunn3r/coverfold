// The AI upscaling models, served from public/models (origin, licences and
// credits in public/models/README.md).

export type ModelId = 'standard' | 'lite' | 'digital' | 'ultramix';

export interface ModelFile { url: string; sha256: string; bytes: number }

export interface UpscaleModel {
  id: ModelId;
  nameKey: string;
  descKey: string;
  scale: 4;
  /** About 16 M weights: slow without a GPU. */
  heavy: boolean;
  nonCommercial: boolean;
  license: string;
  credit: string;
  creditUrl: string;
  param: ModelFile;
  bin: ModelFile;
}

const file = (name: string, sha256: string, bytes: number): ModelFile => ({ url: `${import.meta.env.BASE_URL}models/${name}`, sha256, bytes });

export const MODELS: UpscaleModel[] = [
  {
    id: 'standard', nameKey: 'ai.model.standard', descKey: 'ai.model.standardDesc',
    scale: 4, heavy: true, nonCommercial: false,
    license: 'BSD-3-Clause', credit: 'Real-ESRGAN (Xintao Wang, Tencent ARC)', creditUrl: 'https://github.com/xinntao/Real-ESRGAN',
    param: file('realesrgan-x4plus.param', '35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86', 116029),
    bin: file('realesrgan-x4plus.bin', '713ee713b0353afaa27976f0563a64a5043bd70b9bd8936c2e26e25ebcdbcddf', 33424520),
  },
  {
    id: 'lite', nameKey: 'ai.model.lite', descKey: 'ai.model.liteDesc',
    scale: 4, heavy: false, nonCommercial: false,
    license: 'BSD-3-Clause', credit: 'Real-ESRGAN (Xintao Wang, Tencent ARC)', creditUrl: 'https://github.com/xinntao/Real-ESRGAN',
    param: file('realesr-general-x4v3.param', '22174924330297357434ad21ed0af7f4b820008d2a502b492754d130d4142714', 5019),
    bin: file('realesr-general-x4v3.bin', '85ee266b632a765a725425ba6a5620c088c8aa2939a03063b2d83b3462724cc1', 2435272),
  },
  {
    id: 'digital', nameKey: 'ai.model.digital', descKey: 'ai.model.digitalDesc',
    scale: 4, heavy: false, nonCommercial: false,
    license: 'BSD-3-Clause', credit: 'Real-ESRGAN anime (Xintao Wang, Tencent ARC)', creditUrl: 'https://github.com/xinntao/Real-ESRGAN',
    param: file('realesrgan-x4plus-anime.param', '2b8fb6e0ae4d2d85704ca08c119a2f5ea40add4f2ecd512eb7f4cd44b6127ed4', 30290),
    bin: file('realesrgan-x4plus-anime.bin', 'fe01c269cfd10cdef8e018ab66ebe750cf79c7af4d1f9c16c737e1295229bacc', 8943500),
  },
  {
    id: 'ultramix', nameKey: 'ai.model.ultramix', descKey: 'ai.model.ultramixDesc',
    scale: 4, heavy: true, nonCommercial: true,
    license: 'CC BY-NC-SA 4.0', credit: '4x-UltraMix Balanced (Kim2091)', creditUrl: 'https://huggingface.co/Kim2091/UltraSharp',
    param: file('ultramix-balanced-4x.param', '859ecba5b3592ecf3e76c93bed65e9f627b5236dd696aae5a84ecf8c93ab65ce', 140295),
    bin: file('ultramix-balanced-4x.bin', '171cae5968485d366b4fb575d232f98d117d94b766b15f22849cfccde40d2050', 33424520),
  },
];

export const getModel = (id: ModelId): UpscaleModel => {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
};

export const modelBytes = (m: UpscaleModel): number => m.param.bytes + m.bin.bytes;
