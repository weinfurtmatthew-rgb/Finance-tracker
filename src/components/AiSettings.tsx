import { useState } from 'preact/hooks';
import { enableAi, enableLlm, removeAi, removeLlm, useAi } from '../ai/client';
import { ActionSheet, Row, Section } from './ui';

const mb = (bytes?: number) => (bytes ? `${Math.round(bytes / 1e6)} MB` : '');

export function AiSettings() {
  const ai = useAi();
  const [confirm, setConfirm] = useState<null | 'all' | 'llm'>(null);
  const footer =
    'The AI runs entirely on this phone: a one-time download from this app’s own site, then it works offline. Nothing you type or store is sent anywhere. Numbers in answers are always calculated by the app, not the AI.';

  return (
    <Section title="On-device AI" footer={footer}>
      {ai.phase === 'checking' && <Row title="Checking…" chevron={false} />}
      {ai.phase === 'unavailable' && <Row title="Not available" subtitle="The AI files aren't published with this copy of the app." chevron={false} />}
      {ai.phase === 'off' && (
        <>
          <Row title="Download On-Device AI" subtitle="Category suggestions and questions in your own words." detail={mb(ai.sizeBytes)} onClick={() => void enableAi()} />
        </>
      )}
      {ai.phase === 'downloading' && (
        <div class="row">
          <span class="row-main">
            <span class="row-title">{ai.progress && ai.progress.loaded < ai.progress.total ? 'Downloading…' : 'Loading…'}</span>
            <span class="goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ai.progress?.total ? Math.round((ai.progress.loaded / ai.progress.total) * 100) : 0}>
              <span class="goal-fill" style={{ width: `${ai.progress?.total ? (ai.progress.loaded / ai.progress.total) * 100 : 2}%` }} />
            </span>
            <span class="row-subtitle">
              {ai.progress?.total ? `${mb(ai.progress.loaded)} of ${mb(ai.progress.total)}` : 'Starting…'} · you can keep using the app
            </span>
          </span>
        </div>
      )}
      {ai.phase === 'ready' && (
        <>
          <Row title="Categorizing & questions" subtitle="Suggests categories; understands questions in your own words" detail={ai.embed ? 'On ✓' : 'Off'} chevron={false} />
          {!ai.llmWanted ? (
            <Row
              title="Add Language Model (optional)"
              subtitle="Adds an AI guess of the business to “What is this?” and tries to reword monthly recaps. Large download; Wi-Fi recommended."
              detail={mb(ai.llmSizeBytes)}
              onClick={() => void enableLlm()}
            />
          ) : (
            <>
              <Row
                title="Language model"
                subtitle={ai.llm ? 'Explains bank descriptions; rewords recaps when it gets the numbers right' : `Not running: ${ai.llmError ?? 'unknown error'} Everything else still works.`}
                detail={ai.llm ? 'On ✓' : 'Off'}
                chevron={false}
              />
              <Row title="Remove Language Model" danger chevron={false} onClick={() => setConfirm('llm')} />
            </>
          )}
          <Row title="Remove AI from This Phone" danger chevron={false} onClick={() => setConfirm('all')} />
        </>
      )}
      {ai.phase === 'error' && (
        <>
          <Row title="AI couldn't start" subtitle={ai.error} chevron={false} />
          <Row title="Try Again" onClick={() => void enableAi()} />
          <Row title="Remove AI from This Phone" danger chevron={false} onClick={() => setConfirm('all')} />
        </>
      )}
      {confirm && (
        <ActionSheet
          message={
            confirm === 'llm'
              ? `Delete the language model (${mb(ai.llmSizeBytes)}) from this phone? Category suggestions and questions keep working.`
              : "Delete the downloaded AI models from this phone? Your data isn't affected, and you can download them again later."
          }
          actions={[
            {
              label: confirm === 'llm' ? 'Remove Language Model' : 'Remove AI',
              destructive: true,
              onClick: async () => {
                const which = confirm;
                setConfirm(null);
                await (which === 'llm' ? removeLlm() : removeAi());
              },
            },
          ]}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Section>
  );
}
