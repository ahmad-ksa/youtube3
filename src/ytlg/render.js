// Turns our items into YouTube TV's own page format (formats copied from real TV responses): a browse
// response whose rows (shelfRenderer + horizontalListRenderer) hold video cards (lockupViewModel).

const DAY = 86400;

const t = (s) => ({ content: String(s || '') });

/** Long-press menu of a card: play, go to channel, add/remove the channel from our favourites. */
function menu(it, isFav) {
  const items = [
    {
      menuNavigationItemRenderer: {
        text: { runs: [{ text: 'تشغيل' }] },
        navigationEndpoint: watch(it)
      }
    }
  ];
  if (it.channelId) {
    items.push({
      menuNavigationItemRenderer: {
        text: { runs: [{ text: 'الانتقال إلى القناة' }] },
        navigationEndpoint: { browseEndpoint: { browseId: it.channelId } }
      }
    });
    items.push({
      menuNavigationItemRenderer: {
        text: {
          runs: [
            {
              text: isFav
                ? '💔 إزالة القناة من المفضلة'
                : '❤ إضافة القناة للمفضلة'
            }
          ]
        },
        navigationEndpoint: {
          ytlgCommand: {
            action: 'favorite',
            channelId: it.channelId,
            name: it.sub || ''
          }
        }
      }
    });
  }
  return { menuRenderer: { items } };
}

function watch(it) {
  if (it.type === 'playlist')
    return { watchEndpoint: { videoId: it.videoId, playlistId: it.id } };
  return { watchEndpoint: { videoId: it.id } };
}

/** One video / album card (lockupViewModel, TV layout). */
export function card(it, isFav = () => false) {
  const thumb =
    it.thumb ||
    `https://i.ytimg.com/vi/${it.type === 'playlist' ? it.videoId : it.id}/hqdefault.jpg`;
  const badges = [];
  if (it.duration)
    badges.push({
      thumbnailBadgeViewModel: {
        text: it.duration,
        badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT'
      }
    });
  if (it.type === 'playlist')
    badges.push({
      thumbnailBadgeViewModel: {
        text: it.tracks ? `${it.tracks} ▶` : 'ألبوم',
        badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT'
      }
    });
  const rows = [];
  if (it.sub) rows.push({ metadataParts: [{ text: t(it.sub) }] });
  if (it.meta) rows.push({ metadataParts: [{ text: t(it.meta) }] });
  return {
    lockupViewModel: {
      contentImage: {
        thumbnailViewModel: {
          image: { sources: [{ url: thumb, width: 480, height: 360 }] },
          overlays: badges.length
            ? [{ thumbnailBottomOverlayViewModel: { badges } }]
            : [],
          styling: {
            effects: {
              focusAppearance: 'FOCUS_APPEARANCE_RING',
              hoverAppearance: 'HOVER_APPEARANCE_RING'
            }
          }
        }
      },
      metadata: {
        lockupMetadataViewModel: {
          title: t(it.title),
          metadata: {
            contentMetadataViewModel: { metadataRows: rows, delimiter: ' • ' }
          },
          metadataStyling: {
            secondaryFontSize: 'LOCKUP_METADATA_FONT_SIZE_SMALL'
          }
        }
      },
      contentId: it.type === 'playlist' ? it.id : it.id,
      contentType:
        it.type === 'playlist'
          ? 'LOCKUP_CONTENT_TYPE_PLAYLIST'
          : 'LOCKUP_CONTENT_TYPE_VIDEO',
      styling: {
        layout: 'LOCKUP_LAYOUT_VERTICAL',
        contentImageAspectRatio: 'LOCKUP_CONTENT_IMAGE_ASPECT_RATIO_WIDESCREEN'
      },
      rendererContext: {
        commandContext: {
          onTap: { innertubeCommand: watch(it) },
          onLongPress: {
            innertubeCommand: {
              showMenuCommand: {
                contentId: it.id,
                thumbnail: {
                  thumbnails: [{ url: thumb, width: 480, height: 360 }]
                },
                title: { simpleText: it.title || '' },
                subtitle: { simpleText: it.sub || '' },
                menu: menu(it, isFav(it.channelId))
              }
            }
          }
        }
      }
    }
  };
}

/** One row with a title. */
export function shelf(title, items, isFav) {
  return {
    shelfRenderer: {
      headerRenderer: {
        shelfHeaderRenderer: {
          avatarLockup: {
            avatarLockupRenderer: {
              title: { simpleText: title },
              size: 'AVATAR_LOCKUP_SIZE_SMALL'
            }
          }
        }
      },
      content: {
        horizontalListRenderer: {
          items: items.map((i) => card(i, isFav)),
          collapsedItemCount: 0,
          visibleItemCount: 4
        }
      },
      tvhtml5Style: {
        style: 'TV_SHELF_STYLE_DEFAULT',
        sizeStrategy: 'TV_SHELF_SIZE_STRATEGY_FIXED'
      }
    }
  };
}

/** Full browse response: rows inside the TV surface (what the app renders for a page). */
export function pageOf(shelves) {
  return {
    responseContext: {},
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: { sectionListRenderer: { contents: shelves } }
          }
        }
      }
    }
  };
}

const BUCKETS = [
  [DAY, 'آخر 24 ساعة'],
  [7 * DAY, 'هذا الأسبوع'],
  [31 * DAY, 'هذا الشهر'],
  [365 * DAY, 'هذه السنة'],
  [Infinity, 'أقدم']
];

/**
 * A page for a list that is already sorted newest -> oldest: rows by age (last 24 h, this week, …), each row
 * still newest first, so reading the rows top to bottom and left to right follows the dates.
 * Long rows are split so no row holds more than `perRow` cards.
 */
export function datedPage(title, items, isFav, perRow = 40) {
  const shelves = [];
  let i = 0;
  for (const [max, label] of BUCKETS) {
    const part = [];
    while (i < items.length && (items[i].age ?? 1e12) < max)
      part.push(items[i++]);
    for (let k = 0; k < part.length; k += perRow) {
      const name = `${title} • ${label}${part.length > perRow ? ` (${k / perRow + 1})` : ''}`;
      shelves.push(shelf(name, part.slice(k, k + perRow), isFav));
    }
  }
  if (!shelves.length)
    shelves.push(
      shelf(`${title} • لا يوجد محتوى الآن، جرّب لاحقًا`, [], isFav)
    );
  return pageOf(shelves);
}

/** A page with one plain row (e.g. a list that is not about dates). */
export function simplePage(title, items, isFav) {
  return pageOf([shelf(title, items, isFav)]);
}
