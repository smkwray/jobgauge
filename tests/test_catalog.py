from pathlib import Path

import pytest

from labor_dashboard.io.catalog import CatalogError, load_indicators, validate_catalog


def test_catalog_validates() -> None:
    sources, indicators = validate_catalog(Path("catalog"))
    assert len(sources) >= 5
    assert len(indicators) >= 20
    assert any(indicator.id == "unemployment_rate" for indicator in indicators)


def test_jolts_flow_companion_series_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_series = {
        "hires_rate": "JTS000000000000000HIR",
        "total_separations_level": "JTS000000000000000TSL",
        "total_separations_rate": "JTS000000000000000TSR",
        "quits_level": "JTS000000000000000QUL",
        "layoffs_discharges_level": "JTS000000000000000LDL",
        "other_separations_level": "JTS000000000000000OSL",
        "other_separations_rate": "JTS000000000000000OSR",
    }

    for indicator_id, series_id in expected_series.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.subgroup == "jolts"
        assert "labor flows" in indicator.tags


def test_jolts_total_nonfarm_separations_family_is_complete() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    required = {
        "total_separations_level",
        "total_separations_rate",
        "quits_level",
        "quits_rate",
        "layoffs_discharges_level",
        "layoffs_discharges_rate",
        "other_separations_level",
        "other_separations_rate",
    }

    assert required.issubset(indicators)
    assert {indicators[indicator_id].subgroup for indicator_id in required} == {"jolts"}


def test_claims_have_hosted_fred_and_origin_dol_series() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected = {
        "initial_claims_sa": ("fred", "fred_api", "ICSA", "core"),
        "continued_claims_sa": ("fred", "fred_api", "CCSA", "core"),
        "initial_claims_sa_dol": ("dol", "dol_ui_claims", "ETA/ui_national_weekly_claims/c5", "recommended"),
        "continued_claims_sa_dol": ("dol", "dol_ui_claims", "ETA/ui_national_weekly_claims/c7", "recommended"),
    }

    for indicator_id, (provider, source_id, series_id, priority) in expected.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == provider
        assert indicator.source_id == source_id
        assert indicator.series_id == series_id
        assert indicator.subgroup == "claims"
        assert indicator.priority == priority


def test_alternative_labor_underutilization_measures_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected = {
        "u1_unemployment_15_weeks_over_rate": ("LNS13025670", {"u1", "u-1"}),
        "u2_job_losers_rate": ("LNS14023621", {"u2", "u-2"}),
        "unemployment_rate": ("LNS14000000", {"u3", "u-3"}),
        "u4_unemployed_discouraged_rate": ("LNS13327707", {"u4", "u-4"}),
        "u5_unemployed_marginally_attached_rate": ("LNS13327708", {"u5", "u-5"}),
        "u6_underemployment_rate": ("LNS13327709", {"u6", "u-6"}),
    }

    for indicator_id, (series_id, aliases) in expected.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.subgroup == "household"
        assert indicator.units == "Percent"
        assert indicator.frequency == "M"
        assert indicator.seasonal_adjustment == "SA"
        assert aliases.issubset(set(indicator.aliases))


def test_cps_flow_series_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_series = {
        "cps_flow_employed_to_employed": "LNS17000000",
        "cps_flow_unemployed_to_employed": "LNS17100000",
        "cps_flow_not_in_labor_force_to_employed": "LNS17200000",
        "cps_flow_marginal_inflows_to_employed": "LNS17300000",
        "cps_flow_employed_to_unemployed": "LNS17400000",
        "cps_flow_unemployed_to_unemployed": "LNS17500000",
        "cps_flow_not_in_labor_force_to_unemployed": "LNS17600000",
        "cps_flow_marginal_inflows_to_unemployed": "LNS17700000",
        "cps_flow_employed_to_not_in_labor_force": "LNS17800000",
        "cps_flow_unemployed_to_not_in_labor_force": "LNS17900000",
        "cps_flow_not_in_labor_force_to_not_in_labor_force": "LNS18000000",
        "cps_flow_marginal_inflows_to_not_in_labor_force": "LNS18100000",
        "cps_flow_employed_to_other_outflows": "LNS18200000",
        "cps_flow_unemployed_to_other_outflows": "LNS18300000",
        "cps_flow_not_in_labor_force_to_other_outflows": "LNS18400000",
    }

    for indicator_id, series_id in expected_series.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.group == "flows"
        assert indicator.subgroup == "cps_flows"


def test_bed_flow_series_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_series = {
        "bed_gross_job_gains_level": "BDS0000000000000000110001LQ5",
        "bed_gross_job_gains_rate": "BDS0000000000000000110001RQ5",
        "bed_expansions_level": "BDS0000000000000000110002LQ5",
        "bed_expansions_rate": "BDS0000000000000000110002RQ5",
        "bed_openings_level": "BDS0000000000000000110003LQ5",
        "bed_openings_rate": "BDS0000000000000000110003RQ5",
        "bed_gross_job_losses_level": "BDS0000000000000000110004LQ5",
        "bed_gross_job_losses_rate": "BDS0000000000000000110004RQ5",
        "bed_contractions_level": "BDS0000000000000000110005LQ5",
        "bed_contractions_rate": "BDS0000000000000000110005RQ5",
        "bed_closings_level": "BDS0000000000000000110006LQ5",
        "bed_closings_rate": "BDS0000000000000000110006RQ5",
    }

    for indicator_id, series_id in expected_series.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.group == "flows"
        assert indicator.subgroup == "business_employment_dynamics"


def test_eci_wages_private_uses_official_bls_series() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    indicator = indicators["employment_cost_index_wages_salaries_private"]

    assert indicator.provider == "bls"
    assert indicator.source_id == "bls_public_api"
    assert indicator.series_id == "CIS2020000000000I"


def test_laus_state_unemployment_is_fetchable_multi_series() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    indicator = indicators["laus_state_unemployment_template"]

    assert indicator.provider == "bls"
    assert indicator.source_id == "bls_public_api"
    assert indicator.geography == "state:*"
    assert len(indicator.api_params["series_ids"]) == 52
    assert len(indicator.api_params["geography_by_series_id"]) == 52
    assert indicator.api_params["geography_by_series_id"]["LASST060000000000003"] == "state:06"


def test_high_value_demographic_additions_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_series = {
        "unemployment_level_job_losers": "LNS13023621",
        "unemployment_level_permanent_job_losers": "LNS13026638",
        "unemployment_level_job_leavers": "LNS13023705",
        "unemployment_level_reentrants": "LNS13023557",
        "unemployment_level_new_entrants": "LNS13023569",
        "unemployment_rate_less_than_high_school": "LNS14027659",
        "unemployment_rate_high_school_no_college": "LNS14027660",
        "unemployment_rate_some_college_associate": "LNS14027689",
        "unemployment_rate_bachelors_higher": "LNS14027662",
        "unemployment_rate_with_disability": "LNU04074597",
        "labor_force_participation_rate_with_disability": "LNU01374597",
        "employment_population_ratio_with_disability": "LNU02374597",
        "unemployment_rate_veterans": "LNU04049526",
        "labor_force_participation_rate_veterans": "LNU01349526",
        "employment_population_ratio_veterans": "LNU02349526",
        "unemployment_duration_less_5_weeks": "LNS13008396",
        "unemployment_duration_5_14_weeks": "LNS13008756",
        "unemployment_duration_15_26_weeks": "LNS13008876",
        "long_term_unemployed_27_weeks_over": "LNS13008636",
        "long_term_unemployed_share": "LNS13025703",
        "average_weeks_unemployed": "LNS13008275",
        "median_weeks_unemployed": "LNS13008276",
        "part_time_economic_slack_work": "LNS12032195",
        "part_time_economic_could_only_find_part_time": "LNS12032196",
        "marginally_attached_workers": "LNS15026642",
        "discouraged_workers": "LNS15026645",
        "other_marginally_attached_workers": "LNU05026648",
    }

    for indicator_id, series_id in expected_series.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.group == "demographics"

    assert indicators["other_marginally_attached_workers"].seasonal_adjustment == "NSA"


def test_additional_industry_payroll_series_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_series = {
        "payrolls_mining_logging": "CES1000000001",
        "payrolls_trade_transport_utilities": "CES4000000001",
        "payrolls_information": "CES5000000001",
        "payrolls_financial_activities": "CES5500000001",
        "payrolls_professional_business_services": "CES6000000001",
        "payrolls_education_health_services": "CES6500000001",
        "payrolls_other_services": "CES8000000001",
    }

    for indicator_id, series_id in expected_series.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.series_id == series_id
        assert indicator.subgroup == "industry_payrolls"


def test_total_private_earnings_siblings_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    required = {
        "average_hourly_earnings_total_private": "CES0500000003",
        "average_weekly_hours_total_private": "CES0500000002",
        "average_weekly_earnings_total_private": "CES0500000011",
    }

    for indicator_id, series_id in required.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.series_id == series_id
        assert indicator.frequency == "M"
        assert indicator.seasonal_adjustment == "SA"


def test_laus_state_companion_templates_are_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    expected_templates = {
        "laus_state_labor_force": "LASST{geo}0000000000006",
        "laus_state_employment": "LASST{geo}0000000000005",
        "laus_state_unemployment_level": "LASST{geo}0000000000004",
    }

    for indicator_id, template in expected_templates.items():
        indicator = indicators[indicator_id]
        assert indicator.provider == "bls"
        assert indicator.source_id == "bls_public_api"
        assert indicator.geography == "state:*"
        assert indicator.api_params["series_template"] == template
        assert len(indicator.api_params["geographies"]) == 52
        assert indicator.api_params["geographies"][0] == "01"


def test_sae_state_payroll_template_is_declared() -> None:
    indicators = {indicator.id: indicator for indicator in load_indicators(Path("catalog"))}
    indicator = indicators["sae_state_total_nonfarm_payrolls"]

    assert indicator.provider == "bls"
    assert indicator.source_id == "bls_public_api"
    assert indicator.geography == "state:*"
    assert indicator.api_params["series_template"] == "SMS{geo}000000000000001"
    assert len(indicator.api_params["geographies"]) == 52
    assert indicator.api_params["geographies"][0] == "01"
    assert indicator.api_params["geographies"][-1] == "72"


def test_duplicate_indicator_ids_fail(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog"
    indicators_dir = catalog / "indicators"
    indicators_dir.mkdir(parents=True)
    (catalog / "sources.yml").write_text(
        "sources:\n"
        "  - id: fred_api\n"
        "    title: FRED\n"
        "    owner: FRB St. Louis\n"
        "    provider: fred\n"
        "    access: api\n",
        encoding="utf-8",
    )
    (indicators_dir / "dupes.yml").write_text(
        "indicators:\n"
        "  - id: duplicate\n"
        "    title: One\n"
        "    provider: fred\n"
        "    source_id: fred_api\n"
        "    series_id: ABC\n"
        "    group: test\n"
        "    frequency: M\n"
        "    units: Percent\n"
        "  - id: duplicate\n"
        "    title: Two\n"
        "    provider: fred\n"
        "    source_id: fred_api\n"
        "    series_id: DEF\n"
        "    group: test\n"
        "    frequency: M\n"
        "    units: Percent\n",
        encoding="utf-8",
    )
    with pytest.raises(CatalogError):
        load_indicators(catalog)
