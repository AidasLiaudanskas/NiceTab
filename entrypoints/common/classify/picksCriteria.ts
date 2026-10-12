// 首屏"重点关注"的排序标准。
//
// 这一整段是用户自己写的 prompt，原文照搬，改标准只改这里，代码不用动。
// 留空则退化成"每类取最近的 5 个"，不调用模型。
//
// 注意：原文写的是 "open browser tabs"，但仪表盘里是已保存的标签页
// （大部分是从 Toby 迁移过来的 2018-2021 存档），语义上有出入。
export const PICKS_CRITERIA = `
You are triaging my open browser tabs. Each tab is given as {id, title, url}. Return:
- KEEP: exactly 5 JOB tabs + 5 LEARN tabs to look at next
- CLOSE: up to 10 tabs to close, ranked by confidence
Only use tab ids from the input. Never put a tab in both lists. If a category has fewer good candidates, return fewer. Do not pad.

## Who I am
- Principal ML Engineer at Cox Automotive (via Fyusion acquisition). Background: 3D computer vision, vision-language models, applied ML systems. Cambridge MEng, CVPR paper, US patents in CV / vehicle inspection.
- NYC/Hoboken based, open to SF. Realistic target level: Staff.

## What I'm looking for
- Applied / production ML engineering, NOT pure research.
- Best fit: inference performance, model serving and optimization, multimodal/VLM systems, generative video and world-model infra, 3D/perception for physical AI.
- Top targets: Anthropic (Performance Engineer, Inference Systems; Staff + Senior SE, Inference), OpenAI (SE, Inference - Multi Modal, via referral).
- Next tier: Google DeepMind (SE Model Inference), World Labs, Meta FAIR / Superintelligence (FTE only), General Intuition, Physical Intelligence, Thinking Machines, Together AI, Baseten, Perplexity, Runway, Decart, NVIDIA (inference optimization), Databricks Mosaic serving, Higgsfield, Skild AI.
- Not a fit: contract/agency roles, TPU kernel / JAX-XLA-heavy roles, junior/mid reqs, research scientist roles, PhD-required roles.

## My actual problem
I plan a lot and submit little. Rank JOB tabs by closeness to a submit button today:
1. Open application form or live posting for a target role, top tier first
2. A referral/intro message to send (LinkedIn, Gmail draft, contact profile)
3. A fitting posting that needs CV tailoring first
Downrank: careers landing pages with no specific req, job-board search results, comp/Blind/levels research, "how to get hired" content.

## What I need to learn (rank LEARN tabs by this)
My last Staff loop died on (a) unstructured, hedged answers to open-ended ML system design questions and (b) weak answers on GPU efficiency (MFU vs utilization, FLOP accounting, roofline). Priority:
1. Inference optimization: batching, KV cache, speculative decoding, quantization, distillation, serving (vLLM, TensorRT-LLM, SGLang), Triton/kernels
2. MFU, roofline, profiling, distributed parallelism
3. World models / generative video and their evaluation
4. ML system design interview frameworks with worked examples
5. VLM RL post-training (GRPO/DPO), 3D foundation models (VGGT, DUSt3R, Gaussian splatting), only if tied to a target role

## CLOSE criteria (pick the 10 safest wins)
Close if any applies:
- Duplicate URL or same page open twice (keep one, close the rest)
- Dead, closed or expired job posting; 404/error page; login wall with no content
- Roles in the "not a fit" list above
- Job-board search results, careers landing pages, comp/Blind/levels threads
- News, social feeds and timelines, hype threads, general ML articles outside my learning priorities
Judge social posts (X/Twitter, HN, Reddit) by content, not by domain: a specific thread that explains a technique, reports a benchmark, or links a paper in my learning priorities is a KEEP candidate, not a close. Only close social links that are feeds, timelines, profiles, engagement bait, or commentary with no technical substance.
- Search engine result pages, blank/new tabs, finished checkout or confirmation pages
Never close: Gmail/Calendar/Docs/Notion/GitHub tabs that look like active work, any form with unsaved input, anything in KEEP.
`;

export default { name: 'classify-picks-criteria' };
