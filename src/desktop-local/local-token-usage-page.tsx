import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Save } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/shared/api";
import { useI18n } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

type UsageRow = {
  provider: string;
  model: string;
  day?: string;
  requestCount: number;
  usageRequestCount: number;
  cacheMeasuredRequestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  unclassifiedInputTokens: number;
  outputTokens: number;
};

type Pricing = {
  provider: string;
  model: string;
  uncachedInputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type UsageReport = {
  models: UsageRow[];
  daily: UsageRow[];
  pricing: Pricing[];
};
type PriceField = keyof Omit<Pricing, "provider" | "model">;
type PriceDraft = Record<PriceField, number | "">;
const emptyPrice: PriceDraft = {
  uncachedInputUsdPerMillion: "",
  cachedInputUsdPerMillion: "",
  outputUsdPerMillion: "",
};

const keyOf = (row: Pick<UsageRow, "provider" | "model">) =>
  `${row.provider}\u0000${row.model}`;
const cost = (row: UsageRow, price?: Pricing) =>
  price
    ? (row.uncachedInputTokens * price.uncachedInputUsdPerMillion +
        row.cachedInputTokens * price.cachedInputUsdPerMillion +
        row.outputTokens * price.outputUsdPerMillion) /
      1_000_000
    : undefined;
const toDraft = (price?: Pricing): PriceDraft =>
  price
    ? {
        uncachedInputUsdPerMillion: price.uncachedInputUsdPerMillion,
        cachedInputUsdPerMillion: price.cachedInputUsdPerMillion,
        outputUsdPerMillion: price.outputUsdPerMillion,
      }
    : emptyPrice;
const completePrice = (draft: PriceDraft) =>
  Object.values(draft).every(
    (value) => value !== "" && Number.isFinite(value) && value >= 0,
  );

const cacheTokens = (row: UsageRow, tokens: Intl.NumberFormat) =>
  row.cacheMeasuredRequestCount > 0
    ? tokens.format(row.cachedInputTokens)
    : "—";
const uncachedTokens = (row: UsageRow, tokens: Intl.NumberFormat) =>
  row.cacheMeasuredRequestCount > 0
    ? tokens.format(row.uncachedInputTokens)
    : "—";

export function LocalTokenUsagePage() {
  const { t, locale } = useI18n();
  const tokens = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 2,
      }),
    [locale],
  );
  const dollars = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }),
    [locale],
  );
  const [days, setDays] = useState(30);
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({});
  const client = useQueryClient();
  const queryKey = ["desktop-local", "token-usage", days] as const;
  const report = useQuery({
    queryKey,
    queryFn: () =>
      apiGet<UsageReport>(`/api/local/logs/token-usage?days=${days}`),
  });
  const save = useMutation({
    mutationFn: async ({
      row,
      price,
    }: {
      row: UsageRow;
      price: PriceDraft;
    }) => {
      const response = await fetch("/api/local/logs/token-usage/pricing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: row.provider,
          model: row.model,
          uncachedInputUsdPerMillion: Number(price.uncachedInputUsdPerMillion),
          cachedInputUsdPerMillion: Number(price.cachedInputUsdPerMillion),
          outputUsdPerMillion: Number(price.outputUsdPerMillion),
        }),
      });
      if (!response.ok)
        throw new Error(`Could not save pricing (${response.status})`);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["desktop-local", "token-usage"] }),
  });
  const prices = useMemo(
    () =>
      new Map(
        (report.data?.pricing ?? []).map((price) => [keyOf(price), price]),
      ),
    [report.data?.pricing],
  );
  const models = report.data?.models ?? [];
  const hasCompletePricing =
    models.length > 0 && models.every((row) => prices.has(keyOf(row)));
  const estimatedTotal = models.reduce(
    (sum, row) => sum + (cost(row, prices.get(keyOf(row))) ?? 0),
    0,
  );

  return (
    <section className="space-y-5" aria-labelledby="local-token-usage-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-[var(--brand-50)] p-2.5 text-[var(--brand-700)]">
            <Coins className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="local-token-usage-title" className="text-xl font-semibold">
              {t("desktop.tokenUsage.title")}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t("desktop.tokenUsage.description")}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {t("desktop.tokenUsage.period")}
          <select
            className="compact-native-select rounded-lg border bg-background"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>{t("desktop.tokenUsage.days7")}</option>
            <option value={30}>{t("desktop.tokenUsage.days30")}</option>
            <option value={90}>{t("desktop.tokenUsage.days90")}</option>
            <option value={365}>{t("desktop.tokenUsage.year")}</option>
            <option value={3660}>{t("desktop.tokenUsage.allTime")}</option>
          </select>
        </label>
      </div>

      {report.isPending ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          {t("desktop.tokenUsage.loading")}
        </p>
      ) : report.isError ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {report.error instanceof Error
            ? report.error.message
            : t("desktop.tokenUsage.loadError")}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={t("desktop.tokenUsage.totalInput")}
              value={tokens.format(
                report.data.models.reduce(
                  (sum, row) => sum + row.inputTokens,
                  0,
                ),
              )}
            />
            <Metric
              label={t("desktop.tokenUsage.totalOutput")}
              value={tokens.format(
                report.data.models.reduce(
                  (sum, row) => sum + row.outputTokens,
                  0,
                ),
              )}
            />
            <Metric
              label={t("desktop.tokenUsage.estimatedCost")}
              value={hasCompletePricing ? dollars.format(estimatedTotal) : "—"}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[980px] table-fixed text-left text-sm tabular-nums">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[8%]" />
                <col className="w-[31%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-3">
                    {t("desktop.tokenUsage.providerModel")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.calls")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.input")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.cacheHit")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.cacheMiss")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.output")}
                  </th>
                  <th className="px-2.5 py-3">
                    {t("desktop.tokenUsage.pricePerMillion")}
                  </th>
                  <th className="whitespace-nowrap px-2.5 py-3">
                    {t("desktop.tokenUsage.cost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.data.models.map((row) => {
                  const id = keyOf(row);
                  const saved = prices.get(id);
                  const draft = drafts[id] ?? toDraft(saved);
                  return (
                    <tr key={id} className="border-t align-top">
                      <td className="px-2.5 py-3">
                        <div className="font-medium">{row.provider}</div>
                        <div className="break-all text-xs text-muted-foreground">
                          {row.model}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3">
                        {row.usageRequestCount}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3">
                        {tokens.format(row.inputTokens)}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3">
                        {cacheTokens(row, tokens)}
                      </td>
                      <td className="px-2.5 py-3">
                        {uncachedTokens(row, tokens)}
                        {row.unclassifiedInputTokens > 0 && (
                          <div className="mt-1 text-xs text-amber-700">
                            {t("desktop.tokenUsage.unknownTokens", {
                              count: tokens.format(row.unclassifiedInputTokens),
                            })}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3">
                        {tokens.format(row.outputTokens)}
                      </td>
                      <td className="px-2.5 py-3">
                        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_2rem] items-center gap-1">
                          {(
                            [
                              "uncachedInputUsdPerMillion",
                              "cachedInputUsdPerMillion",
                              "outputUsdPerMillion",
                            ] as const
                          ).map((field) => (
                            <Input
                              key={field}
                              aria-label={`${row.provider} ${row.model} ${field}`}
                              className="h-8 min-w-0 w-full px-2"
                              min="0"
                              step="0.01"
                              type="number"
                              value={draft[field]}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [id]: {
                                    ...draft,
                                    [field]: event.target.value
                                      ? Number(event.target.value)
                                      : "",
                                  },
                                }))
                              }
                            />
                          ))}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t(
                              "desktop.tokenUsage.savePricingAria",
                              {
                                model: row.model,
                              },
                            )}
                            disabled={save.isPending || !completePrice(draft)}
                            onClick={() => save.mutate({ row, price: draft })}
                          >
                            <Save className="size-4" />
                          </Button>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 font-medium">
                        {saved ? dollars.format(cost(row, saved) ?? 0) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!report.data.models.length && (
              <p className="p-5 text-sm text-muted-foreground">
                {t("desktop.tokenUsage.empty")}
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-semibold">
              {t("desktop.tokenUsage.dailyBreakdown")}
            </h3>
            <div className="max-h-[30rem] overflow-auto rounded-xl border">
              <table className="w-full min-w-[720px] table-fixed text-left text-sm tabular-nums">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[22%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.day")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.providerModel")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.input")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.cacheHit")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.cacheMiss")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.output")}
                    </th>
                    <th className="px-2.5 py-3">
                      {t("desktop.tokenUsage.cost")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.daily.map((row) => {
                    const price = prices.get(keyOf(row));
                    return (
                      <tr key={`${row.day}-${keyOf(row)}`} className="border-t">
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {row.day}
                        </td>
                        <td className="px-2.5 py-3">
                          <span className="font-medium">{row.provider}</span>
                          <br />
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.model}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {tokens.format(row.inputTokens)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {cacheTokens(row, tokens)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {uncachedTokens(row, tokens)}
                          {row.unclassifiedInputTokens > 0 ? "*" : ""}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {tokens.format(row.outputTokens)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-3">
                          {price ? dollars.format(cost(row, price) ?? 0) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {report.data.daily.some(
              (row) => row.unclassifiedInputTokens > 0,
            ) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("desktop.tokenUsage.unclassifiedNote")}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
