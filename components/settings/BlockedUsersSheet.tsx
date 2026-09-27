"use client";

import { Ban } from "lucide-react";
import { useState } from "react";
import { DEFAULT_MEMBER_NAME, unblockUser } from "../../lib/messages";
import type { BlockedUser } from "../../lib/settings";
import Avatar from "../ui/Avatar";
import BottomSheet from "../ui/BottomSheet";

// Ayarlar → Engellenen kullanıcılar: listeyi gösterir, engeli kaldırır.
// Engel kalkınca kişi yeniden mesaj gönderebilir ve takip edebilir.
export default function BlockedUsersSheet({
  myId,
  users,
  failed = false,
  onRetry,
  onUnblocked,
  onClose,
}: {
  myId: string;
  /** null: yükleniyor */
  users: BlockedUser[] | null;
  /** Liste yüklenemedi */
  failed?: boolean;
  onRetry?: () => void;
  onUnblocked: (userId: string) => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUnblock(user: BlockedUser) {
    setPending(user.id);
    setError(null);
    try {
      await unblockUser(myId, user.id);
      onUnblocked(user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Engel kaldırılamadı.");
    } finally {
      setPending(null);
    }
  }

  return (
    <BottomSheet title="Engellenen kullanıcılar" onClose={onClose} closeLabel="Kapat">
      <div className="max-h-[55dvh] overflow-y-auto px-2">
        {failed ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <p className="text-[15px] text-[#5B616B]">Liste yüklenemedi. Bağlantını kontrol edip tekrar dene.</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="h-10 rounded-xl bg-[#E9ECEF] px-4 text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
              >
                Tekrar dene
              </button>
            )}
          </div>
        ) : users === null ? (
          <p role="status" className="px-3 py-8 text-center text-[15px] text-[#5B616B]">
            Yükleniyor…
          </p>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F2F3F5] text-[#8A9099]">
              <Ban aria-hidden="true" className="h-6 w-6" />
            </span>
            <p className="text-[15.5px] font-semibold">Kimseyi engellemedin</p>
            <p className="max-w-xs text-[13.5px] text-[#5B616B]">
              Bir sohbette ⋯ menüsünden engellediğin kişiler burada listelenir.
            </p>
          </div>
        ) : (
          <ul aria-label="Engellenen kullanıcılar">
            {users.map((user) => {
              const name = user.displayName ?? (user.username ? `@${user.username}` : DEFAULT_MEMBER_NAME);
              return (
                <li key={user.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
                  <Avatar url={user.avatarUrl} name={user.displayName ?? user.username} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15.5px] font-semibold">{name}</span>
                    {user.displayName && user.username && (
                      <span className="block truncate text-[13px] text-[#5B616B]">@{user.username}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleUnblock(user)}
                    disabled={pending !== null}
                    aria-label={`${name} engelini kaldır`}
                    className="h-9 shrink-0 rounded-xl bg-[#E9ECEF] px-3.5 text-[14px] font-semibold text-[#15181C] transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003399]"
                  >
                    {pending === user.id ? "Kaldırılıyor…" : "Engeli kaldır"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p role="alert" className="px-3 pb-2 text-center text-[13px] font-medium text-[#B42318]">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
