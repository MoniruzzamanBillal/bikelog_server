export type TSpendingInsightResponse = {
  insight: string;
  generated: boolean;
  cached: boolean;
};

export type TMileageInsightResponse = {
  insight: string;
  generated: boolean;
  cached: boolean;
};

export type TChatRequestMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TBikeChatResponse = {
  reply: string;
};
