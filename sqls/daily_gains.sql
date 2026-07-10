import json
from datetime import datetime, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from google.auth.transport.requests import Request
from google.oauth2.service_account import Credentials

SPREADSHEET_ID = "1ifLuJzfhRqdFd8sgyIcse214s2v3Z5o1eit10b8yUd8"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]
HELSINKI_TZ = ZoneInfo("Europe/Helsinki")
SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

EXPORT_DATAFRAMES = {
    "data_gains": dataframe_5,
    "data_seg_beh": dataframe,
    "data_event_inst": dataframe_2,
    "data_event_accrual": dataframe_4,
    "data_event_kite_accrual": dataframe_3,
}

HEADER_NOTES = {
    "data_gains": {
        "engagement_segment": "7d-saga-completion tier (A.0 / B.1-9 / ... / F.100+).",
        "payer_flag": "NONPAYER / PAYER lifetime payer flag from cumulative_money_spent > 0.",
        "resource": "Currency or item gained, e.g. HC, boosters, unlimited lives, SPT / SPTx2 (season pass tokens; SPTx2 = the double-value token, weighted x2 for tier progression).",
        "unit": "Native unit of resource: HC, count, or minutes.",
        "category": "Mapped source category where the gain came from.",
        "resource_earners": "Distinct players who earned >0 of this resource in this segment x payer tier.",
        "recipients": "Distinct players who earned this resource from this category.",
        "recipient_rate_pct": "recipients / resource_earners * 100.",
        "pct_of_resource_pool": "Category amount / this tier's total pool of this resource; whale-weighted.",
        "mean_share_all_earners_pct": "Mean over all earners of their personal % from this category, zeros included.",
        "category_amount": "Total free gains of this resource from this category.",
        "resource_pool_amount": "Total free gains of this resource from all categories within the tier.",
        "amount_per_earner": "category_amount / resource_earners; headline per-player value.",
        "amount_per_recipient": "category_amount / recipients.",
    },
    "data_seg_beh": {
        "segment": "7d-saga-completion tier; A.0 zero-completion days are excluded, so 0-9 represents B.1-9 only.",
        "payer_flag": "NONPAYER / PAYER lifetime payer flag from cumulative_money_spent > 0.",
        "seg_rank": "Segment sort key.",
        "unique_players": "Distinct players in the cohort, assigned by modal segment.",
        "player_days": "Active player-days in the window.",
        "dau": "player_days / 33.",
        "payer_rate_pct": "% of the segment that is PAYER; repeats across payer rows.",
        "active_days_mean": "Mean active days per player over 33 days.",
        "active_days_p25": "25th percentile active days per player over 33 days.",
        "active_days_p50": "Median active days per player over 33 days.",
        "active_days_p75": "75th percentile active days per player over 33 days.",
        "active_days_p90": "90th percentile active days per player over 33 days.",
        "weekday_active_rate": "Probability a cohort member is active on a given weekday date.",
        "weekend_active_rate": "Probability a cohort member is active on a given weekend date.",
        "mon_active_rate": "Monday active probability.",
        "tue_active_rate": "Tuesday active probability.",
        "wed_active_rate": "Wednesday active probability.",
        "thu_active_rate": "Thursday active probability.",
        "fri_active_rate": "Friday active probability.",
        "sat_active_rate": "Saturday active probability.",
        "sun_active_rate": "Sunday active probability.",
        "login_streak_mean": "Mean longest consecutive-active-day run per player.",
        "login_streak_p50": "Median longest consecutive-active-day run per player.",
        "login_streak_p75": "75th percentile longest consecutive-active-day run per player.",
        "login_streak_p90": "90th percentile longest consecutive-active-day run per player.",
        "sessions_per_active_day": "NULL placeholder; session source is not confirmed.",
        "saga_completes_per_active_day": "Saga levels completed per active day.",
        "levels_played_per_active_day": "All levels entered per active day.",
        "levels_completed_per_active_day": "All levels completed per active day.",
        "minutes_per_active_day": "Minutes played per active day.",
        "daily_gift_claim_rate_pct": "% of active days where Daily Gift was claimed.",
        "gift_hc_free_per_active_day": "Free HC from Daily Gift per active day.",
        "daily_max_streak_mean": "Mean in-day saga win-streak; Night Sky/Kite input.",
        "daily_max_streak_p50": "Median in-day saga win-streak.",
        "daily_max_streak_p75": "75th percentile in-day saga win-streak.",
        "daily_max_streak_p90": "90th percentile in-day saga win-streak.",
    },
    "data_event_inst": {
        "event_name": "Canonical event name.",
        "payer_flag": "NONPAYER / PAYER lifetime payer flag.",
        "segment": "Segment tier.",
        "seg_rank": "Segment sort key.",
        "n_instances": "Instances of this event in the window.",
        "active_window_player_instances": "Active player x instance rows; denominator.",
        "avg_participants_per_instance": "participants / n_instances.",
        "participation_rate": "participants / active-window population.",
        "opt_in_rate": "exposed via event_start / active-window population.",
        "recipient_rate": "participants unlocking >=1 milestone reward / participants.",
        "position_p25": "25th percentile final leaderboard position among participants; lower is better.",
        "position_p50": "Median final leaderboard position among participants; lower is better.",
        "position_p75": "75th percentile final leaderboard position among participants; lower is better.",
        "avg_final_token_balance": "Mean end-of-event token balance among participants.",
        "avg_bots": "Mean bots on board; position context.",
    },
    "data_event_accrual": {
        "event_name": "Canonical token-event name.",
        "payer_flag": "NONPAYER / PAYER lifetime payer flag.",
        "segment": "Segment tier.",
        "seg_rank": "Segment sort key.",
        "event_day": "Day index within instance; 1 = first day.",
        "instance_length_days": "N days of the instance.",
        "n_instances": "Instances pooled.",
        "n_participants": "Distinct participants in the cohort.",
        "cum_token_share_mean": "Mean cumulative token share by this day; duration multiplier.",
        "cum_token_share_p50": "Median cumulative token share by this day.",
        "cum_token_share_p25": "25th percentile cumulative token share by this day.",
        "cum_token_share_p75": "75th percentile cumulative token share by this day.",
        "cum_levels_share_mean": "Secondary effort proxy: cumulative event-levels / total, token-gated.",
    },
    "data_event_kite_accrual": {
        "event_name": "Kite Festival.",
        "payer_flag": "NONPAYER / PAYER lifetime payer flag.",
        "segment": "Segment tier.",
        "seg_rank": "Segment sort key.",
        "event_day": "Day index within Kite instance; 1 = first day.",
        "instance_length_days": "N days of the instance.",
        "n_instances": "Kite instances pooled.",
        "n_participants": "Distinct participants with positive total score.",
        "cum_token_share_mean": "Mean cumulative score share by this day; named like token share for sheet compatibility.",
        "cum_token_share_p50": "Median cumulative score share by this day.",
        "cum_token_share_p25": "25th percentile cumulative score share by this day.",
        "cum_token_share_p75": "75th percentile cumulative score share by this day.",
        "cum_levels_share_mean": "NULL for Kite; score path, no level tokens.",
    },
}

valid_actions = set(EXPORT_DATAFRAMES) | {"export_all", "refresh_all_export", ""}
action = str(export_action_input or "").strip()
request_id = str(export_request_id_input or "").strip()
started_at = datetime.now(timezone.utc)


def _sheet_names_for_action(action_name):
    if action_name in {"export_all", "refresh_all_export"}:
        return list(EXPORT_DATAFRAMES)
    if action_name in EXPORT_DATAFRAMES:
        return [action_name]
    return []


def _json_ready(value):
    if pd.isna(value):
        return ""
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _frame_values(df):
    headers = list(df.columns)
    rows = [[_json_ready(v) for v in row] for row in df.to_numpy().tolist()]
    return headers, rows


def _header_notes(sheet_name, headers):
    sheet_notes = HEADER_NOTES.get(sheet_name, {})
    return [sheet_notes.get(header, "") for header in headers]


def _authorized_headers():
    credentials = Credentials.from_service_account_info(json.loads(puzzle_google_credentials), scopes=SCOPES)
    credentials.refresh(Request())
    return {"Authorization": f"Bearer {credentials.token}"}


def _request(method, url, headers, **kwargs):
    response = requests.request(method, url, headers=headers, timeout=300, **kwargs)
    response.raise_for_status()
    return response.json() if response.text else {}


def _sheet_ids(headers):
    url = f"{SHEETS_API_BASE}/{SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)"
    metadata = _request("GET", url, headers)
    return {sheet["properties"]["title"]: sheet["properties"]["sheetId"] for sheet in metadata["sheets"]}


def _range(sheet_name, a1):
    return f"'{sheet_name}'!{a1}"


def _export_sheet(headers, sheet_ids, sheet_name, df):
    if sheet_name not in sheet_ids:
        raise KeyError(f"Sheet not found: {sheet_name}")

    column_headers, data_rows = _frame_values(df)
    values = [column_headers] + data_rows
    notes = _header_notes(sheet_name, column_headers)

    clear_range = quote(_range(sheet_name, "A:ZZZ"), safe="")
    _request("POST", f"{SHEETS_API_BASE}/{SPREADSHEET_ID}/values/{clear_range}:clear", headers, json={})

    write_range = quote(_range(sheet_name, "A1"), safe="")
    _request(
        "PUT",
        f"{SHEETS_API_BASE}/{SPREADSHEET_ID}/values/{write_range}?valueInputOption=RAW",
        headers,
        json={"values": values},
    )

    batch_update_body = {
        "requests": [
            {
                "updateCells": {
                    "range": {
                        "sheetId": sheet_ids[sheet_name],
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": len(column_headers),
                    },
                    "rows": [{"values": [{"note": note} for note in notes]}],
                    "fields": "note",
                }
            },
            {
                "repeatCell": {
                    "range": {
                        "sheetId": sheet_ids[sheet_name],
                        "startRowIndex": 0,
                        "endRowIndex": 1,
                        "startColumnIndex": 0,
                        "endColumnIndex": len(column_headers),
                    },
                    "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                    "fields": "userEnteredFormat.textFormat.bold",
                }
            },
        ]
    }
    _request("POST", f"{SHEETS_API_BASE}/{SPREADSHEET_ID}:batchUpdate", headers, json=batch_update_body)

    return {
        "sheet_name": sheet_name,
        "rows_written": int(len(data_rows)),
        "columns_written": int(len(column_headers)),
    }

rows_written = 0
sheets_exported = []
status = "idle"
message = "No export requested."
response_text = None
response_status_code = None
exported_at_helsinki = pd.NaT

if action and request_id:
    if action not in valid_actions:
        status = "error"
        message = f"Unknown export action: {action}"
    else:
        results = []
        try:
            auth_headers = _authorized_headers()
            sheet_id_lookup = _sheet_ids(auth_headers)
            for sheet_name in _sheet_names_for_action(action):
                result = _export_sheet(auth_headers, sheet_id_lookup, sheet_name, EXPORT_DATAFRAMES[sheet_name])
                rows_written += result["rows_written"]
                sheets_exported.append(sheet_name)
                results.append(result)
            status = "success"
            exported_at_helsinki = datetime.now(HELSINKI_TZ)
            message = f"Exported {rows_written:,} rows with header notes to {len(sheets_exported)} sheet(s)."
        except Exception as exc:
            status = "error"
            message = str(exc)
        response_text = json.dumps(results, ensure_ascii=False)[:4000]

finished_at = datetime.now(timezone.utc)
export_status = pd.DataFrame([
    {
        "status": status,
        "action": action,
        "request_id": request_id,
        "sheets_exported": ", ".join(sheets_exported),
        "rows_written": rows_written,
        "started_at_utc": started_at,
        "finished_at_utc": finished_at if status != "idle" else pd.NaT,
        "exported_at_helsinki": exported_at_helsinki,
        "duration_seconds": round((finished_at - started_at).total_seconds(), 2) if status != "idle" else None,
        "message": message,
        "response_status_code": response_status_code,
        "response_text": response_text,
    }
])

export_status