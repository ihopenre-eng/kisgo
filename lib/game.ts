export type ThrowResult = {
  hit: boolean;
  grade: 'Excellent' | 'Great' | 'Nice';
  xp: number;
  chance: number;
};
export function judgeThrow(
  x: number,
  y: number,
  targetX: number,
  targetY: number,
  radius: number,
  ringScale: number,
  curve: boolean,
  ballRadius = 0,
): ThrowResult {
  const distance = Math.hypot(x - targetX, y - targetY);
  const hit = distance <= radius + ballRadius;
  const inside = distance <= radius * ringScale + ballRadius;
  const grade =
    inside && ringScale <= 0.4
      ? 'Excellent'
      : inside && ringScale <= 0.72
        ? 'Great'
        : 'Nice';
  return {
    hit,
    grade,
    xp:
      (grade === 'Excellent' ? 150 : grade === 'Great' ? 100 : 50) +
      (curve ? 25 : 0),
    chance:
      curve && hit
        ? 1
        : Math.min(
            0.98,
            (grade === 'Excellent' ? 0.96 : grade === 'Great' ? 0.87 : 0.76) +
              (curve ? 0.06 : 0),
          ),
  };
}

export function captureSucceeded(
  result: ThrowResult,
  failures: number,
  roll: number,
): boolean {
  void failures;
  void roll;
  return result.hit;
}

export function judgeContact(
  point: { x: number; y: number; r: number },
  target: { x: number; y: number; r: number },
  ringScale: number,
  curve: boolean,
): ThrowResult {
  const result = judgeThrow(
    point.x,
    point.y,
    target.x,
    target.y,
    target.r,
    ringScale,
    curve,
    point.r,
  );
  // 호출 전에 화면상의 연속 충돌이 확인되어 있다. 반올림 오차로 접촉을 취소하지 않는다.
  return { ...result, hit: true, chance: 1 };
}
export function projectSwipe(
  startX: number,
  startY: number,
  dx: number,
  dy: number,
  elapsed: number,
  height: number,
  curve: number,
) {
  const speed = Math.min(1.5, Math.max(0, -dy) / Math.max(100, elapsed));
  return {
    x: startX + dx * 1.45 + curve * 0.4,
    y: startY - Math.min(height * 0.86, Math.max(70, -dy * 1.6 + speed * 60)),
  };
}
export type FriendCard = {
  id: string;
  name: string;
  photo: string;
  date: string;
  grade: string;
  xp: number;
  demo: boolean;
  curve: boolean;
};
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('friend-go', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('friends', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('다른 탭의 도감을 닫고 다시 시도해주세요.'));
  });
}
export async function listFriends(): Promise<FriendCard[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('friends', 'readonly');
      const request = tx.objectStore('friends').getAll();
      request.onsuccess = () =>
        resolve(
          request.result.sort((a: FriendCard, b: FriendCard) =>
            b.date.localeCompare(a.date),
          ),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeFriend(card: FriendCard) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('friends', 'readwrite');
      tx.objectStore('friends').put(card);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function deleteFriend(id: string) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('friends', 'readwrite');
      tx.objectStore('friends').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
