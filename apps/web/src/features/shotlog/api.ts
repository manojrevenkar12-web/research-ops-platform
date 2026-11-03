import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/lib/api";

export type Outcome = "nominal" | "partial" | "misfire" | "aborted";

export interface Campaign {
  id: string;
  code: string;
  title: string;
  facility: string;
  entity: string;
  classification: "internal" | "restricted";
  lead_name: string;
  starts_on: string;
  ends_on: string | null;
  shots: number;
  last_shot_at: string | null;
}

export interface Shot {
  id: string;
  shot_no: number;
  fired_at: string;
  target_serial: string | null;
  logged_by_name: string;
  classification: string;
  energy_j: string | null;
  pulse_ns: string | null;
  outcome: Outcome;
  notes: string;
  corrections: number;
}

export interface SearchHit {
  id: string;
  campaign_id: string;
  campaign_code: string;
  shot_no: number;
  fired_at: string;
  outcome: Outcome;
  snippet: string;
}

export interface CampaignDetail extends Campaign {
  members: { person_id: string; role: string; display_name: string }[];
}

export const useCampaigns = () =>
  useQuery({ queryKey: ["campaigns"], queryFn: () => api<Campaign[]>("/api/shotlog/campaigns") });
export const useCampaign = (id: string | undefined) =>
  useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<CampaignDetail>(`/api/shotlog/campaigns/${id}`),
    enabled: !!id,
  });
export const useShots = (id: string | undefined) =>
  useQuery({
    queryKey: ["shots", id],
    queryFn: () => api<Shot[]>(`/api/shotlog/campaigns/${id}/shots?limit=100`),
    enabled: !!id,
  });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: ["search", q],
    queryFn: () => api<SearchHit[]>(`/api/shotlog/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
  });

export function useLogShot(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      fired_at: string;
      outcome: Outcome;
      energy_j: number | null;
      pulse_ns: number | null;
      notes: string;
    }) =>
      api<{ id: string; shot_no: number }>(`/api/shotlog/campaigns/${campaignId}/shots`, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}
