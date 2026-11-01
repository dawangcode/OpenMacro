// 赞助模块文案与数据（src/constants/sponsor.ts）
// 设置页「支持作者」卡的文案都收在这里——改文案只改这一处。
// 地址非空时入口渲染为超链接；当前已填作者真实主页。
import sponsorAlipayQr from '@/assets/sponsor-alipay.png'
import sponsorWechatQr from '@/assets/sponsor-wechat.png'

/** 主文案：四行打油诗，每行 8 音——一二句「见底 / 渐空」对仗写窘境，三四句收在「快 / 归来」；
 *  改 / 快 / 归来 同押怀来辙，第二句弃韵换对仗。\n 由 whiteSpace: pre-line 渲染成四行 */
export const SPONSOR_POEM =
  '代码我写，Bug 我改；\ntoken 见底，咖啡渐空。\n你用着顺，我改得快；\n偶尔打赏，满血归来。'

/** 提需求入口说明：「用力 / 包涵」对仗 */
export const SPONSOR_FEEDBACK = '想提需求？视频评论区留言，作者每晚潜水翻牌；催更请用力，拖更请包涵'

/** B 站入口：作者空间主页（学而习-，UID 123631211） */
export const BILIBILI_URL: string = 'https://space.bilibili.com/123631211'

/** B 站行：三连具体是哪三下 + 提需求怎么说 */
export const BILIBILI_HINT =
  'B 站一键三连 = 点赞 + 投币 + 收藏（官方三件套，关注要点进 UP 主空间）。作者定期翻视频评论区：留言的需求会收进清单，挑有共性的、能落地的排期实现。'

/** 抖音入口：作者主页长链（sec_uid 形式，抖音号不能直接拼成 /user/ 地址） */
export const DOUYIN_URL: string =
  'https://www.douyin.com/user/MS4wLjABAAAAt0uLMyyRlU7GpULl-9TOYeHS2lgl39RorwHxoKk7QfYGz_FbXpNNHuRQsYnqgmpV'

/** 抖音行：这里提需求怎么说才有效 */
export const DOUYIN_HINT =
  '作者也会潜水翻抖音视频评论区：点赞是零成本支持；提需求时说清使用场景（什么软件、什么操作），比一句「求优化」更容易被排进迭代。'

/** 闲鱼店铺：作者主页（用户名 Done，userId 62577168）。
 *  m.tb.cn 短链是分享用的临时链，会失效，这里存规范的店铺地址 */
export const XIANYU_URL: string = 'https://www.goofish.com/personal?userId=62577168'

/** 闲鱼行：只作打赏入口，不承载需求反馈；提需求统一去视频评论区 */
export const XIANYU_HINT =
  '闲鱼只作打赏入口：店铺里的「openmacro通用宏」1 元链接，下单即支持、金额随意；提需求或反馈请走视频评论区，不用在闲鱼留言。'

/** 打赏码：两张图都打进 asar（不走远程 URL）；换码只替换 src/assets 下对应的 png，代码不用动 */
export const SPONSOR_CODES: { key: string; label: string; src: string }[] = [
  { key: 'alipay', label: '支付宝', src: sponsorAlipayQr },
  { key: 'wechat', label: '微信', src: sponsorWechatQr },
]

/** 标题旁问号：只补「金额」这一条差异信息；
 *  「不赏功能也在」这类承诺刻意不写——软件不卖功能，写了反而像辩解 */
export const SPONSOR_TITLE_HINT = '金额随意，一块也是爱。'
