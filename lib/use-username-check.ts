"use client";

import { useEffect, useState } from "react";
import { checkUsernameAvailability } from "./profile";
import { localUsernameStatus, type UsernameStatus } from "./username";

export type UsernameCheck = UsernameStatus | "idle" | "checking" | "error";

/** Yazmayı bıraktıktan sonra sunucuya sorulur */
export const USERNAME_CHECK_DELAY_MS = 400;

/**
 * Canlı müsaitlik kontrolü: biçim ve rezerve anında (ağsız), alınmış olup
 * olmadığı yazma durduktan sonra sunucudan. Eski istek sonucu yeni yazılanın
 * üstüne yazılmaz.
 */
export function useUsernameCheck(name: string, check = checkUsernameAvailability): UsernameCheck {
  const local = name === "" ? "idle" : localUsernameStatus(name);
  const [remote, setRemote] = useState<{ name: string; status: UsernameCheck } | null>(null);

  useEffect(() => {
    if (local !== null) return;
    let active = true;
    const timer = window.setTimeout(() => {
      check(name)
        .then((status) => active && setRemote({ name, status }))
        .catch(() => active && setRemote({ name, status: "error" }));
    }, USERNAME_CHECK_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [name, local, check]);

  if (local !== null) return local;
  return remote?.name === name ? remote.status : "checking";
}
