import type { Definition, Root } from 'mdast'
import { visit } from 'unist-util-visit'

/** CommonMark 引用标识重复时，采用原稿中第一处定义。 */
export function collectDefinitions(root: Root): ReadonlyMap<string, Definition> {
  const definitions = new Map<string, Definition>()
  visit(root, 'definition', (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node)
  })
  return definitions
}
