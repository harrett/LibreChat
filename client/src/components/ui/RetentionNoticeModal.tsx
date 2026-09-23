import { useAtom } from 'jotai';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import { createStorageAtom } from '~/store/jotai-utils';
import { useLocalize } from '~/hooks';

/** Acknowledged per browser, which is also the scope of the account the notice is about. */
const acknowledgedAtom = createStorageAtom('retentionNoticeAcknowledged', false);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tells a first-time visitor that the throwaway account behind their session is
 * deleted after a period without use. Shown only for accounts that carry a
 * `purgeAt`, and only until acknowledged.
 */
export default function RetentionNoticeModal({ purgeAt }: { purgeAt?: string }) {
  const localize = useLocalize();
  const [acknowledged, setAcknowledged] = useAtom(acknowledgedAtom);

  if (acknowledged || purgeAt == null) {
    return null;
  }

  const days = Math.round((new Date(purgeAt).getTime() - Date.now()) / ONE_DAY_MS);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }

  return (
    <OGDialog open onOpenChange={() => setAcknowledged(true)}>
      <OGDialogTemplate
        title={localize('com_ui_retention_notice_title')}
        className="w-11/12 max-w-md"
        showCloseButton={false}
        showCancelButton={false}
        main={
          <p className="px-2 py-1 text-sm text-text-primary">
            {localize('com_ui_retention_notice', { 0: days })}
          </p>
        }
        selection={{
          selectHandler: () => setAcknowledged(true),
          selectText: localize('com_ui_confirm'),
        }}
      />
    </OGDialog>
  );
}
