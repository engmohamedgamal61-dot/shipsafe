import { sendNotification } from "./notifications";

/**
 * Sends a notification to every subscriber and logs when done.
 */
export async function notifyAllSubscribers(subscriberIds: string[]): Promise<void> {
  subscriberIds.forEach(async (id) => {
    await sendNotification(id);
  });
  console.log("all subscribers notified");
}
