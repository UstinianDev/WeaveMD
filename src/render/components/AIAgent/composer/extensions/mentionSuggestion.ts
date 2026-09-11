// ============================================
// WeaveMD — @mention 补全建议配置（TipTap Suggestion）
// ============================================
// char: '@'，从文件树 store 获取文件/文件夹列表，按 query 过滤，
// 选中后插入 mentionTag 节点。

import { ReactRenderer } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { MentionSuggestionList, type MentionSuggestionListRef } from './MentionSuggestionList';

/** @mention 选项类型（文件/目录）。 */
export interface MentionOption {
  type: 'file' | 'folder';
  id: string;
  name: string;
  path?: string;
  description?: string;
}

/** 外部注入文件树数据的回调类型。 */
export type MentionItemsGetter = (query: string) => MentionOption[];

/** 全局文件树数据缓存（由 AIPanelComposer 持续更新）。 */
let getMentionItems: MentionItemsGetter = () => [];

export function setMentionItemsGetter(getter: MentionItemsGetter): void {
  getMentionItems = getter;
}

/** 创建 @mention 补全 TipTap Extension（通过 addProseMirrorPlugins 注册）。 */
export function createMentionSuggestionExtension(): Extension {
  return Extension.create({
    name: 'mentionSuggestion',

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          pluginKey: new PluginKey('mentionSuggestion'),
          char: '@',
          allowSpaces: true,
          allowedPrefixes: null,
          startOfLine: false,
          decorationTag: 'span',
          decorationClass: 'suggestion-decoration',

          items: ({ query }: { query: string }) => {
            return getMentionItems(query);
          },

          command: ({ editor: ed, range, props }: { editor: Editor; range: { from: number; to: number }; props: MentionOption }) => {
            ed.chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'mentionTag',
                attrs: {
                  type: props.type,
                  id: props.id,
                  name: props.name,
                  path: props.path ?? '',
                },
              })
              .insertContent(' ')
              .run();
          },

          render: () => {
            let component: ReactRenderer<MentionSuggestionListRef> | null = null;
            let unmountFn: (() => void) | null = null;

            return {
              onStart: (props: SuggestionProps<MentionOption>) => {
                component = new ReactRenderer(MentionSuggestionList, {
                  props: {
                    items: props.items,
                    command: (item: MentionOption) => {
                      props.command(item);
                    },
                  },
                  editor: props.editor,
                });
                unmountFn = props.mount(component.element);
              },

              onUpdate: (props: SuggestionProps<MentionOption>) => {
                component?.updateProps({
                  items: props.items,
                  command: (item: MentionOption) => {
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
