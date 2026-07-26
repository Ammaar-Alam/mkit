import { type ContentStatusResponse, POPUP_STATUS_MESSAGE } from "../shared/popup-status";

export type PopupPageStatus = "active" | "supported-not-running" | "unsupported";

export interface PopupPageState {
  status: PopupPageStatus;
  detail: string;
  issues?: string[];
}

interface ActiveTab {
  id?: number;
}

interface PopupStatusDependencies {
  getActiveTab(): Promise<ActiveTab | undefined>;
  getContentStatus(tabId: number): Promise<ContentStatusResponse | undefined>;
}

export async function getPopupPageState(
  dependencies: PopupStatusDependencies = chromePopupStatusDependencies(),
): Promise<PopupPageState> {
  const tab = await dependencies.getActiveTab();
  if (tab?.id === undefined) {
    return unsupported();
  }

  // Without a host permission the popup cannot read this tab's URL, so an absent
  // reply is the only available signal that MKit does not run here.
  let status: ContentStatusResponse | undefined;
  try {
    status = await dependencies.getContentStatus(tab.id);
  } catch {
    return unsupported();
  }
  if (status === undefined) {
    return unsupported();
  }

  if (status.attached) {
    return {
      status: "active",
      detail: "Fresh Attempt is ready on this review.",
    };
  }
  if (status.route === "review" || status.route === "incomplete-review") {
    const issues = status.issues ?? [];
    return {
      status: "supported-not-running",
      detail: "This review is still loading or its layout could not be verified.",
      ...(issues.length > 0 ? { issues } : {}),
    };
  }
  return unsupported();
}

function unsupported(): PopupPageState {
  return {
    status: "unsupported",
    detail: "Open a completed review to use Fresh Attempt.",
  };
}

function chromePopupStatusDependencies(): PopupStatusDependencies {
  return {
    async getActiveTab(): Promise<ActiveTab | undefined> {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab === undefined) return undefined;
      return tab.id === undefined ? {} : { id: tab.id };
    },
    async getContentStatus(tabId: number): Promise<ContentStatusResponse | undefined> {
      return chrome.tabs.sendMessage(tabId, {
        type: POPUP_STATUS_MESSAGE,
      }) as Promise<ContentStatusResponse | undefined>;
    },
  };
}
