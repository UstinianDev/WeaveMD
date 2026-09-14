// ============================================
// WeaveMD — 交互提问向导式面板（R2: 向导模式重构）
// ============================================
// 从列表式改为单题向导：每次只显示一道题，字体放大，进度圆点指示器，
// 选择题/确认题 300ms 自动跳转，文本题手动"下一题"，
// 未回答提交时红色震动 + 跳转到未答题。
// 无 dangerouslySetInnerHTML、无 any。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IClarifyQuestion } from '@shared/ai';
import { useI18n } from '@render/i18n';

interface QuestionCardProps {
  questions: IClarifyQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  /** R5: 卡片视觉变体。delete_confirm 显示红色警告样式（删除操作不可恢复）。 */
  variant?: 'default' | 'delete_confirm';
  /** 轮次信息：当 round + totalRounds 都有值时标题显示 "追问（X/Y）"。 */
  round?: number;
  /** 轮次信息：总轮数。 */
  totalRounds?: number;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  questions,
  onSubmit,
  variant = 'default',
  round,
  totalRounds,
}) => {
  const { t } = useI18n();

  // ---- 向导状态机 ----
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward');
  const [shakeTarget, setShakeTarget] = useState<string | null>(null);
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [otherText, setOtherText] = useState('');

  // 面板滑入（从底部：保留原始行为）
  const [visible, setVisible] = useState(false);
  // 题间滑动段落（pre = 动画起始位，active = 正常位）
  const [slidePhase, setSlidePhase] = useState<'pre' | 'active'>('active');
  const isInitialMount = useRef(true);

  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  const isDeleteConfirm = variant === 'delete_confirm';

  // ---- 面板滑入 ----
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- 条件依赖：过滤出当前应显示的问题 ----
  const visibleQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (q.dependsOn && q.condition) {
        const depAnswer = answers[q.dependsOn];
        return depAnswer === q.condition;
      }
      return true;
    });
  }, [questions, answers]);

  // ---- currentIndex 边界保护 ----
  useEffect(() => {
    if (visibleQuestions.length === 0) return;
    if (currentIndex >= visibleQuestions.length) {
      setCurrentIndex(Math.max(0, visibleQuestions.length - 1));
    }
  }, [visibleQuestions.length, currentIndex]);

  // ---- 切换题目时：重置"其它"输入、触发滑动动画 ----
  useEffect(() => {
    setShowOtherInput(false);
    setOtherText('');
    // 首屏不播放滑动动画
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setSlidePhase('pre');
    const raf = requestAnimationFrame(() => setSlidePhase('active'));
    return () => cancelAnimationFrame(raf);
  }, [currentIndex]);

  // ---- "其它"输入框自动聚焦 ----
  useEffect(() => {
    if (showOtherInput && otherInputRef.current) {
      otherInputRef.current.focus();
    }
  }, [showOtherInput]);

  // ---- 卸载时清除自动跳转定时器 ----
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    };
  }, []);

  // ---- 派生值 ----
  const currentQuestion = visibleQuestions[currentIndex] ?? null;
  const isSingle = visibleQuestions.length <= 1;
  const isLast = currentIndex === visibleQuestions.length - 1;
  const isFirst = currentIndex === 0;

  // ---- 导航 ----
  const goNext = useCallback(() => {
    if (isLast) return;
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    setSlideDirection('forward');
    setCurrentIndex((prev) => prev + 1);
  }, [isLast]);

  const goPrev = useCallback(() => {
    if (isFirst) return;
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
    setSlideDirection('backward');
    setCurrentIndex((prev) => prev - 1);
  }, [isFirst]);

  // ---- 选择/确认：选中后 300ms 自动跳转（最后一题不自动跳转） ----
  const handleChoiceSelect = useCallback(
    (id: string, value: string) => {
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
      setAnswers((prev) => ({ ...prev, [id]: value }));
      setShowOtherInput(false);
      setOtherText('');

      if (!isLast) {
        autoAdvanceRef.current = setTimeout(() => {
          setSlideDirection('forward');
          setCurrentIndex((prev) => prev + 1);
        }, 300);
      }
    },
    [isLast]
  );

  // ---- 提交验证：找到第一个未回答的题，震动跳转 ----
  const handleSubmit = useCallback(() => {
    for (let i = 0; i < visibleQuestions.length; i++) {
      const q = visibleQuestions[i];
      const ans = answers[q.id];
      if (ans === undefined || ans.trim() === '') {
        setCurrentIndex(i);
        setShakeTarget(q.id);
        setTimeout(() => setShakeTarget(null), 2000);
        return;
      }
    }
    onSubmit(answers);
  }, [visibleQuestions, answers, onSubmit]);

  // ---- 文本输入 ----
  const handleTextChange = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isLast) {
          handleSubmit();
        } else {
          goNext();
        }
      }
    },
    [isLast, goNext, handleSubmit]
  );

  // ---- "其它"按钮 ----
  const handleOtherClick = useCallback(() => {
    setShowOtherInput(true);
    setOtherText(answers[currentQuestion?.id ?? ''] ?? '');
  }, [answers, currentQuestion]);

  const handleOtherChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setOtherText(e.target.value);
  }, []);

  const handleOtherBlur = useCallback(() => {
    if (currentQuestion) {
      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: otherText }));
    }
  }, [currentQuestion, otherText]);

  const handleOtherKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentQuestion) {
          setAnswers((prev) => ({ ...prev, [currentQuestion.id]: otherText }));
        }
        if (isLast) {
          handleSubmit();
        } else {
          goNext();
        }
      }
    },
    [currentQuestion, otherText, isLast, goNext, handleSubmit]
  );

  // ---- 空问题集 ----
  if (visibleQuestions.length === 0) return null;

  // ---- 标题渲染 ----
  const titleContent = (() => {
    if (isDeleteConfirm) {
      return (
        <div className="flex items-center gap-2 px-4 pb-2 text-[14px] font-semibold text-red-500">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          {t('ai.question.deleteTitle', '此操作不可恢复')}
        </div>
      );
    }

    let titleStr: string;
    if (round != null && totalRounds != null) {
      titleStr = t('ai.question.roundFormat', `追问（${round}/${totalRounds}）`);
    } else if (round != null) {
      titleStr = t('ai.question.roundSingle', `第 ${round} 轮提问`);
    } else {
      titleStr = t('ai.question.slideTitle', 'AI 需要更多信息');
    }

    return (
      <div className="flex items-center gap-2 px-4 pb-2 text-[14px] font-semibold text-[var(--accent)]">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
        {titleStr}
      </div>
    );
  })();

  // ---- 进度圆点指示器（纯指示器，不可点击） ----
  const progressDots = !isSingle ? (
    <div className="flex justify-center gap-2 px-4 pb-3">
      {visibleQuestions.map((q, i) => {
        const hasAnswer = answers[q.id] !== undefined && answers[q.id].trim() !== '';
        const isCurrent = i === currentIndex;
        let dotClassName =
          'w-2 h-2 rounded-full transition-all duration-300';
        if (isCurrent) {
          dotClassName += ' w-3 h-3 bg-[var(--accent)] ring-2 ring-[var(--accent)]/30';
        } else if (hasAnswer) {
          dotClassName += ' bg-[var(--accent)]/60';
        } else {
          dotClassName += ' border border-[var(--text-muted)] bg-transparent';
        }
        return <div key={q.id} className={dotClassName} />;
      })}
    </div>
  ) : null;

  // ---- 当前题渲染 ----
  const renderQuestionContent = () => {
    if (!currentQuestion) return null;
    const q = currentQuestion;
    const answer = answers[q.id] ?? '';
    const isShaking = shakeTarget === q.id;

    return (
      <div
        className={`space-y-3 p-4 rounded-lg border transition-colors duration-300 ${
          isShaking
            ? 'border-red-500 question-card-shake'
            : 'border-border/50 bg-bg-tertiary/30'
        }`}
      >
        {/* 题号 + 题目文本 */}
        <div className="flex items-start gap-2">
          {!isSingle && (
            <span className="text-[13px] text-[var(--accent)] font-semibold shrink-0 mt-0.5">
              {currentIndex + 1}/{visibleQuestions.length}
            </span>
          )}
          <label className="text-[15px] text-[var(--accent)] font-bold leading-relaxed">
            {q.text}
          </label>
        </div>

        {/* 文本题 */}
        {q.type === 'text' && (
          <input
            id={`q-${q.id}`}
            type="text"
            value={answer}
            onChange={(e) => handleTextChange(q.id, e.target.value)}
            onKeyDown={handleTextKeyDown}
            placeholder={t('ai.question.inputPlaceholder', '请输入...')}
            className="w-full rounded-input border border-border bg-bg-tertiary px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none transition-colors"
          />
        )}

        {/* 选择题 */}
        {q.type === 'choice' && q.options && (
          <>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt, idx) => {
                const isSelected = answer === opt;
                const letter = String.fromCharCode(65 + idx);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleChoiceSelect(q.id, opt)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[14px] border transition-all duration-200 ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm'
                        : 'border-border text-text-muted hover:border-[var(--accent)]/50 hover:text-text-primary'
                    }`}
                  >
                    <span
                      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded text-[13px] font-semibold ${
                        isSelected
                          ? 'bg-[var(--accent)] text-white'
                          : 'border border-border text-text-muted'
                      }`}
                    >
                      {letter}
                    </span>
                    {opt}
                  </button>
                );
              })}
              {/* "其它"按钮 */}
              <button
                type="button"
                onClick={handleOtherClick}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[14px] border transition-all duration-200 ${
                  showOtherInput
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] shadow-sm'
                    : 'border-border text-text-muted hover:border-[var(--accent)]/50 hover:text-text-primary'
                }`}
              >
                {t('ai.question.other', '其它')}
              </button>
            </div>
            {/* "其它"内联文本输入框 */}
            {showOtherInput && (
              <input
                ref={otherInputRef}
                type="text"
                value={otherText}
                onChange={handleOtherChange}
                onKeyDown={handleOtherKeyDown}
                onBlur={handleOtherBlur}
                placeholder={t('ai.question.inputPlaceholder', '请输入...')}
                className="w-full rounded-input border border-[var(--accent)]/30 bg-bg-tertiary px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted focus:border-[var(--accent)] focus:outline-none transition-colors"
              />
            )}
          </>
        )}

        {/* 确认题 */}
        {q.type === 'confirm' && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleChoiceSelect(q.id, 'yes')}
              className={`px-4 py-2 rounded-input text-[14px] border transition-colors ${
                answer === 'yes'
                  ? isDeleteConfirm
                    ? 'bg-red-500 border-red-500 text-white'
                    : 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : isDeleteConfirm
                    ? 'border-red-300 text-red-400 hover:border-red-500 hover:text-red-500'
                    : 'border-border text-text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >
              {isDeleteConfirm
                ? t('ai.question.confirmDelete', '确认删除')
                : t('ai.question.yes', '是')}
            </button>
            <button
              type="button"
              onClick={() => handleChoiceSelect(q.id, 'no')}
              className={`px-4 py-2 rounded-input text-[14px] border transition-colors ${
                answer === 'no'
                  ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'border-border text-text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >
              {isDeleteConfirm
                ? t('ai.question.cancelDelete', '取消')
                : t('ai.question.no', '否')}
            </button>
          </div>
        )}
      </div>
    );
  };

  // ---- 题间滑动位移 ----
  const slideTransform =
    slidePhase === 'pre'
      ? slideDirection === 'forward'
        ? 'translateX(100%)'
        : 'translateX(-100%)'
      : 'translateX(0)';
  const slideOpacity = slidePhase === 'pre' ? 0 : 1;

  // ---- 导航按钮 ----
  const navButtons = !isSingle ? (
    <div className="flex justify-between items-center px-4 pt-2">
      {/* 左侧：上一题 */}
      <div>
        {!isFirst && (
          <button
            type="button"
            onClick={goPrev}
            className="px-4 py-2 rounded-lg text-[13px] border border-border text-text-sub hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-all duration-200"
          >
            {t('ai.question.prev', '上一题')}
          </button>
        )}
      </div>
      {/* 右侧：文本题的"下一题" / 最后一题的"提交" */}
      <div className="flex gap-2">
        {currentQuestion?.type === 'text' && !isLast && (
          <button
            type="button"
            onClick={goNext}
            className="px-4 py-2 rounded-lg text-[13px] border border-border text-text-sub hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-all duration-200"
          >
            {t('ai.question.next', '下一题')}
          </button>
        )}
        {isLast && (
          <button
            type="button"
            onClick={handleSubmit}
            className={`px-6 py-2 rounded-lg text-[13px] font-medium text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] ${
              isDeleteConfirm
                ? 'bg-gradient-to-r from-red-500 to-red-600'
                : 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]'
            }`}
          >
            {isDeleteConfirm
              ? t('ai.question.confirmDeleteAction', '确认删除')
              : t('ai.question.submit', '提交回答')}
          </button>
        )}
      </div>
    </div>
  ) : null;

  // ---- 单题模式提交按钮 ----
  const singleSubmitButton = isSingle ? (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={handleSubmit}
        className={`w-full rounded-lg px-3 py-2.5 text-[13px] font-medium text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] ${
          isDeleteConfirm
            ? 'bg-gradient-to-r from-red-500 to-red-600'
            : 'bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)]'
        }`}
      >
        {isDeleteConfirm
          ? t('ai.question.confirmDeleteAction', '确认删除')
          : t('ai.question.submit', '提交回答')}
      </button>
    </div>
  ) : null;

  return (
    <>
      {/* 半透明遮罩层：覆盖消息流区域，阻止交互 */}
      <div
        className="absolute inset-0 z-40 bg-black/30 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      />

      {/* 底部滑出面板 */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 rounded-t-card border border-border border-b-0 bg-bg-secondary shadow-[0_-4px_24px_rgba(0,0,0,0.15),0_-1px_8px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-out font-['Alibaba_PuHuiTi_2.0',Consolas,system-ui,sans-serif]"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          maxHeight: '70vh',
        }}
      >
        {/* 顶部 accent 发光边线 */}
        <div className="absolute top-0 left-4 right-4 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-60 rounded-full" />

        {/* 拖拽指示条 */}
        <div className="flex justify-center py-2.5 cursor-grab">
          <div className="w-10 h-1 rounded-full bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-50 hover:opacity-80 hover:w-14 transition-all duration-300" />
        </div>

        {/* 标题 */}
        {titleContent}

        {/* 进度圆点 */}
        {progressDots}

        {/* 题目滑动容器 */}
        <div
          className="px-4"
          style={{
            transform: slideTransform,
            opacity: slideOpacity,
            transition: 'transform 200ms ease-out, opacity 200ms ease-out',
          }}
        >
          {renderQuestionContent()}
        </div>

        {/* 导航栏 / 提交按钮 */}
        {navButtons}
        {singleSubmitButton}
      </div>
    </>
  );
};

export default QuestionCard;