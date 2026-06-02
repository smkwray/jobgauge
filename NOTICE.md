# Data attribution notice

This project aggregates labor-market data from public statistical sources and mirrors. Preserve source names, series IDs, release names, units, frequency, seasonal adjustment, and geography when presenting or redistributing generated data.

## Origin-agency sources

- U.S. Bureau of Labor Statistics: Current Population Survey, Current Employment Statistics, Job Openings and Labor Turnover Survey, Local Area Unemployment Statistics, Consumer Price Index, Employment Cost Index, Business Employment Dynamics, Productivity and Costs, and QCEW open data.
- U.S. Census Bureau: Quarterly Workforce Indicators / LEHD data.
- U.S. Bureau of Economic Analysis: BEA API data where cataloged or added in future refreshes.
- U.S. Department of Labor / Employment and Training Administration: unemployment insurance claims data where fetched through the DOL Data Portal.

## FRED mirrors

The hosted-dashboard export can include FRED mirror series for convenience and context. FRED should be labeled as a mirror/access layer where it republishes another agency's series, not as the original producer.

Redistributable offline exports should use `make export-static-origin`, which excludes FRED-derived values from the static data files. Do not bundle FRED-derived value files into offline packages unless a maintainer explicitly approves that distribution path.

## Presentation requirements

Dashboard views should show the source owner or provider, release name, series ID, units, frequency, seasonal adjustment, geography, and latest observation date near charts or in accessible metadata.
