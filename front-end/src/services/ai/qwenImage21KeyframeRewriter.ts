import type { QwenImage21KeyframeBrief } from '../../components/StageDirector/utils';
import { chatCompletion, getActiveChatModelName } from './apiCore';

const parseRewrittenPrompt = (raw: string): string => {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] || text).trim();
  try {
    const parsed = JSON.parse(body) as { rewritten_prompt?: string };
    if (parsed?.rewritten_prompt) return String(parsed.rewritten_prompt);
  } catch {
    const match = body.match(/"rewritten_prompt"\s*:\s*"([\s\S]*?)"\s*}/);
    if (match?.[1]) return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return '';
};

const SECTION_HEADERS = ['【本镜】', '【时间点】', '【视觉中心】', '【场景】', '【人物】', '【道具】', '【画面】'];

const normalizeSections = (value: string): string => String(value || '')
  .replace(/\\n/g, '\n')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
  .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const acceptRewrite = (prompt: string, brief: QwenImage21KeyframeBrief): string => {
  const text = normalizeSections(prompt);
  if (text.length < 80 || text.length > 2800) return '';
  if (SECTION_HEADERS.some((header) => !text.includes(header))) return '';
  if (/【任务】|8K|masterpiece|最佳质量|缓慢推|推近|仙乐/i.test(text)) return '';
  const missingName = [...brief.characters.map((item) => item.name), ...brief.props.map((item) => item.name)]
    .filter(Boolean)
    .some((name) => !text.includes(name));
  if (missingName) return '';
  if (brief.references.length >= 2 && brief.references.some((item) => !text.includes(item.tag))) return '';
  if (brief.references.length === 1 && /<image\d+>/i.test(text)) return '';
  return text;
};

const instructionFor = (brief: QwenImage21KeyframeBrief, feedback = ''): string => `你是 Qwen-Image-2.1 的图像编辑提示词改写器。根据下面的结构化事实，写一条可直接执行的编辑指令。规范来自 Qwen Image 2.1 Edit：多图必须使用 <image1>、<image2> 这类标签，属性解耦，只改本帧要求的内容。

输出一个 JSON 对象，不要 Markdown。rewritten_prompt 必须按下面七个小标题换行，不要写成一整段：
{"rewritten_prompt":"【本镜】\\n...\\n【时间点】\\n...\\n【视觉中心】\\n...\\n【场景】\\n...\\n【人物】\\n- ...\\n【道具】\\n- ...\\n【画面】\\n..."}

小标题顺序固定，每个小标题单独一行，内容写在下一行：
【本镜】先用两三句话写清这一帧的人物、道具和场景关系：谁在哪、对着谁、拿着什么、谁和谁共持或分开、场景上看得见的结果是什么。这是人工核对和生图都要遵守的总述，后面各节只能展开它，不能另写一种姿态、视线或数量。
【时间点】这一帧发生在什么瞬间，只写一个时间点。
【视觉中心】谁是第一视觉中心，谁是第二视觉中心，背景线索是什么。
【场景】用对应的 <imageN> 说明环境参考。允许按本次机位重新取景。只写当前可见的光和气氛。
【人物】每个角色单独一行，写成「- 名字（<imageN>，数量）：位置、朝向、一个姿态、一个视线目标、表情」。数量紧挨着右括号，单人必须写成「，1）」，例如「- 主角（<image2>，1）：」。只有一张参考图、不写 <imageN> 时也要写成「- 名字（参考图，1）：」。姿态和视线必须与【本镜】相同。
【道具】每件道具单独一行，写成「- 名字（<imageN>）：持有者、一个握持或放置关系」。没有参考图就不要写 <imageN>。握持关系必须与【本镜】相同，一行里只保留一种。
【画面】风格、静态机位，以及除旗面原有标识外不新增文字。

写法：
- 这是用多张参考图合成一张新的静帧。场景参考只提供环境，人物参考只锁定脸、毛发、头身比例和服装，道具参考只锁定形状、材质、颜色和正常尺寸。
- ${brief.references.length >= 2 ? `必须逐张使用这些标签，不能遗漏：${brief.references.map((item) => item.tag).join('、')}。` : '只有一张参考图时不要写 <imageN> 标签，直接称“参考图”。'}
- 只写这一张静帧看得见的内容。不要写运镜、声音、光线变化和动作过程。
- 事实冲突时只保留一种状态。一行里不要同时写横贯、低持、抬起和即将挥出。
- 蓄势用浅弓步或稳定站姿，保持躯干伸展，不要写成深蹲或伏地。
- 群演每人的视线只指向一个目标。同一件道具的数量只写一种：每人各持一件，或全组共持一件。
- 振动改成落尘、木屑、旗面褶皱。不要写画幅比例、分辨率或 8K。

结构化事实：
${JSON.stringify(brief)}
${feedback ? `\n上一稿未通过：${feedback}\n请重写完整指令。` : ''}`;

/** 规则只提供事实；最终提示词由对话模型按 Qwen Image 2.1 Edit 规范重写。失败时返回空字符串，由调用方回退。 */
export const rewriteQwenImage21KeyframePrompt = async (
  brief: QwenImage21KeyframeBrief,
): Promise<string> => {
  if (!brief.storyState && !brief.frameSentence && brief.characters.length === 0) return '';
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await chatCompletion(
        instructionFor(brief, feedback),
        getActiveChatModelName(),
        0.2,
        2048,
        'json_object',
        90000,
      );
      const accepted = acceptRewrite(parseRewrittenPrompt(raw), brief);
      if (accepted) return accepted;
      feedback = '必须先写【本镜】关系总述，再按【时间点】【视觉中心】【场景】【人物】【道具】【画面】分行；人物和道具各自一行，且不得与【本镜】矛盾；保留每个名字和全部 <imageN> 标签；不要写成一整段，不要写运镜或声音。';
    } catch (error) {
      console.warn('[QwenImage21] 关键帧提示词重写失败，回退规则编译。', error);
      return '';
    }
  }
  return '';
};
