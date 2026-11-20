import { copyRichText } from '@/core/clipboard/copy-rich-text'
import { collectImageSources, createAssetRegistry } from '@/core/images/assets'
import { parseDocument } from '@/core/markdown/parse'
import { typeset } from '@/core/pipeline/typeset'
import type { StudioPorts } from './ports'

/**
 * 真实核心层的接线处。核心模块由排版核心负责人维护，
 * 这里只做转发，保证界面在测试中可以换成替身。
 */
export const corePorts: StudioPorts = {
  parse: (markdown) => parseDocument(markdown),
  typeset: (input, selection) => typeset(input, selection && { platforms: 'id' in selection ? [selection] : selection }),
  createAssets: (entries) => createAssetRegistry(entries),
  copyRichText: (payload) => copyRichText(payload),
  collectImages: (parsed) => collectImageSources(parsed),
}
