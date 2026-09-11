// ============================================
// WeaveMD — /skill 补全建议配置（TipTap Suggestion）
// ============================================
// char: '/'，从 listSkills() 获取技能列表，按 query 过滤，
// 选中后插入 skillTag 节点。

import { ReactRenderer } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { AgentSkillInfo } from '@shared/ai';
import { SkillSuggestionList, type SkillSuggestionListRef } from './SkillSuggestionList';

/** 全局技能缓存（组件挂载时加载一次）。 */
let cachedSkills: AgentSkillInfo[] = [];

export function setCachedSkills(skills: AgentSkillInfo[]): void {
  cachedSkills = skills;
}

/** 创建 /skill 补全 TipTap Extension（通过 addProseMirrorPlugins 注册）。 */
export function createSkillSuggestionExtension(): Extension {
  return Extension.create({
    name: 'skillSuggestion',

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: new PluginKey('skillSuggestion'),
          char: '/',
          allowSpaces: false,
          allowedPrefixes: null,
          startOfLine: false,
          decorationTag: 'span',
          decorationClass: 'suggestion-decoration',

          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase();
            if (!q) return cachedSkills.slice(0, 8);
            return cachedSkills
              .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
              .slice(0, 8);
          },

          command: ({ editor: ed, range, props }: { editor: Editor; range: { from: number; to: number }; props: AgentSkillInfo }) => {
            ed.chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'skillTag',
                attrs: { name: props.name, description: props.description },
              })
              .insertContent(' ')
              .run();
          },

          render: () => {
            let component: ReactRenderer<SkillSuggestionListRef> | null = null;
            let unmountFn: (() => void) | null = null;

            return {
              onStart: (props: SuggestionProps<AgentSkillInfo>) => {
                component = new ReactRenderer(SkillSuggestionList, {
                  props: {
                    items: props.items,
                    command: (item: AgentSkillInfo) => {
                      props.command(item);
                    },
                  },
                  editor: props.editor,
                });
                unmountFn = props.mount(component.element);
              },

              onUpdate: (props: SuggestionProps<AgentSkillInfo>) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: AgentSkillInfo) => {
                    props.command(item);
                  },
                });
              },

              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  unmountFn?.();
                  component?.destroy();
                  component = null;
                  return true;
                }
                return component?.ref?.onKeyDown(props) ?? false;
              },

              onExit: () => {
                unmountFn?.();
                component?.destroy();
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
