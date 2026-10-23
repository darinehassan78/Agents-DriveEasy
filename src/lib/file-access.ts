import "server-only";

/** Whether a (non-admin) user may view damage photos for a reservation: only its customer. */
export async function canViewDamagePhotos(reservationId: string, userId: string): Promise<boolean> {
  // TODO(app-agent): use db-agent's reservation lookup once published; admins-only until then.
  void reservationId;
  void userId;
  return false;
}
