"""Turns assessments into actions a person can take, each with its reason."""

from dataclasses import dataclass

from .engine import TWO_HOUR_LIMIT_H, Assessment


@dataclass
class Recommendation:
    level: str  # 'critical' or 'warning'
    title: str
    reason: str
    item_id: str | None = None


def _hours(h: float) -> str:
    if h < 1:
        return f'{round(h * 60)} min'
    if h < 48:
        return f'{h:.1f} h'
    return f'{h / 24:.1f} days'


def _to_f(c: float) -> float:
    return c * 1.8 + 32


def recommend(assessments: list[Assessment], zone_avg_temp_c: dict[str, float]) -> list[Recommendation]:
    """zone_avg_temp_c: recent average air temperature of each zone, used to
    suggest moving food somewhere colder."""
    recs: list[Recommendation] = []
    coldest = min(zone_avg_temp_c, key=zone_avg_temp_c.get) if zone_avg_temp_c else None

    for a in sorted(assessments, key=lambda a: a.score):
        name = a.item.name.lower()

        if a.status == 'discard':
            recs.append(Recommendation(
                'critical',
                f'Discard the {name}',
                f'About {_hours(a.danger_zone_hours)} above 40°F in total; USDA advises discarding '
                f'perishables after {TWO_HOUR_LIMIT_H:.0f} hours.',
                a.item.id,
            ))
            continue
        if a.status == 'expired':
            recs.append(Recommendation('critical', f'Check the {name} before using',
                                       'It is past its estimated shelf life.', a.item.id))
            continue
        if a.status == 'at_risk':
            recs.append(Recommendation('critical', f'Use the {name} today',
                                       f'About {_hours(a.remaining_hours)} of shelf life left.', a.item.id))

        lost = a.loss_by_cause
        total_lost = sum(lost.values())
        if total_lost < 1:
            continue

        if a.condensation_minutes >= 10 and a.profile.id == 'berries':
            recs.append(Recommendation(
                'warning', f'Dry the {name}',
                f'Moisture condensed on them for {_hours(a.condensation_minutes / 60)} after warm air got in, '
                'which speeds up mold.',
                a.item.id,
            ))
        elif lost.get('dry air', 0) >= 0.25 * total_lost:
            recs.append(Recommendation(
                'warning', f'Bag the {name} or move them to the crisper',
                f'Dry air has cost about {_hours(lost["dry air"])} of freshness.',
                a.item.id,
            ))

        if (
            lost.get('temperature', 0) >= 0.5 * total_lost
            and coldest is not None
            and a.item.zone != coldest
            and zone_avg_temp_c[a.item.zone] - zone_avg_temp_c[coldest] >= 1
        ):
            diff_f = (zone_avg_temp_c[a.item.zone] - zone_avg_temp_c[coldest]) * 1.8
            recs.append(Recommendation(
                'warning', f'Move the {name} to the {coldest} zone',
                f'It runs about {diff_f:.1f}°F colder than the {a.item.zone} zone.',
                a.item.id,
            ))

    worst = max(
        (e for a in assessments for e in a.excursions if e.cause == 'temperature'),
        key=lambda e: e.end - e.start,
        default=None,
    )
    if worst and worst.end - worst.start >= 15 * 60:
        recs.append(Recommendation(
            'warning', 'Check the door seal',
            f'Air stayed warm for {_hours((worst.end - worst.start) / 3600)}, '
            f'peaking at {_to_f(worst.peak_air_c):.0f}°F.',
        ))

    return recs
