package com.music.bitchord.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Radio
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.music.bitchord.data.model.HomeShelf
import com.music.bitchord.data.model.MoodGenre
import com.music.bitchord.data.model.MoodGenreSection
import com.music.bitchord.data.model.ShelfItem
import com.music.bitchord.data.model.UiState
import com.music.bitchord.ui.components.PAGE_GUTTER
import com.music.bitchord.ui.theme.AccentRed

/**
 * BeatMusic's Radio tab, laid out the way Apple Music's Radio page is: a large
 * bold title, one big hero station card, a carousel of stations seeded from
 * songs and a grid of genre & mood stations.
 *
 * Every card does something real. "Your Station" and the song stations start
 * an endless radio queue seeded from that track (the same radio the rest of
 * the app builds); a genre station opens that genre's playlists.
 */
@Composable
fun RadioScreen(
    homeState: UiState<List<HomeShelf>>,
    exploreState: UiState<List<MoodGenreSection>>,
    nowPlayingTitle: String?,
    listState: LazyListState,
    contentPadding: PaddingValues,
    onStartYourStation: () -> Unit,
    onSongStation: (ShelfItem) -> Unit,
    onGenreStation: (MoodGenre) -> Unit,
    modifier: Modifier = Modifier,
) {
    val songSeeds = remember(homeState) {
        (homeState as? UiState.Success)?.data.orEmpty()
            .flatMap { it.items }
            .filter { it.videoId != null }
            .distinctBy { it.videoId }
            .take(14)
    }
    val genres = remember(exploreState) {
        (exploreState as? UiState.Success)?.data.orEmpty()
            .flatMap { it.items }
            .distinctBy { it.browseId + (it.params ?: "") }
            .take(16)
    }
    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
    ) {
        item(key = "radio_title") {
            Text(
                text = "Radio",
                style = MaterialTheme.typography.displayLarge,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(horizontal = PAGE_GUTTER, vertical = 8.dp),
            )
        }
        item(key = "radio_hero") {
            HeroStation(
                subtitle = nowPlayingTitle?.let { "Inspired by $it" } ?: "Endless music picked from what you play",
                onClick = onStartYourStation,
            )
        }
        if (songSeeds.isNotEmpty()) {
            item(key = "radio_songs_header") { RadioSectionHeader("Stations for You") }
            item(key = "radio_songs") {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = PAGE_GUTTER),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(songSeeds, key = { it.videoId ?: it.title }) { item ->
                        SongStationCard(item = item, onClick = { onSongStation(item) })
                    }
                }
            }
        } else if (homeState is UiState.Loading) {
            item(key = "radio_loading") { RadioHint("Tuning stations…") }
        }
        if (genres.isNotEmpty()) {
            item(key = "radio_genre_header") { RadioSectionHeader("Genre & Mood Stations") }
            genres.chunked(2).forEachIndexed { index, row ->
                item(key = "radio_genre_$index") {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier
                            .padding(horizontal = PAGE_GUTTER)
                            .padding(bottom = 12.dp),
                    ) {
                        row.forEach { genre ->
                            MoodGenreSleeve(
                                item = genre,
                                modifier = Modifier
                                    .weight(1f)
                                    .aspectRatio(1.9f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { onGenreStation(genre) },
                            )
                        }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        if (songSeeds.isEmpty() && genres.isEmpty() && homeState !is UiState.Loading) {
            item(key = "radio_empty") {
                RadioHint("Play a song or open Home and Browse once, and your stations show up here.")
            }
        }
        item(key = "radio_footer") { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun HeroStation(subtitle: String, onClick: () -> Unit) {
    Column(Modifier.padding(horizontal = PAGE_GUTTER, vertical = 8.dp)) {
        Text(
            text = "BEATMUSIC RADIO",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            letterSpacing = 0.6.sp,
        )
        Text(
            text = "Your Station",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1.6f)
                .clip(RoundedCornerShape(14.dp))
                .background(
                    Brush.linearGradient(
                        listOf(Color(0xFFFF6A88), AccentRed, Color(0xFF8E0E2A)),
                    ),
                )
                .clickable(onClick = onClick),
        ) {
            Icon(
                Icons.Rounded.Radio,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.18f),
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 12.dp)
                    .size(170.dp),
            )
            Column(
                Modifier
                    .align(Alignment.BottomStart)
                    .padding(18.dp),
            ) {
                Text(
                    text = "Your\nStation",
                    color = Color.White,
                    fontSize = 34.sp,
                    lineHeight = 34.sp,
                    fontWeight = FontWeight.W800,
                    style = MaterialTheme.typography.displayLarge,
                )
                Spacer(Modifier.height(12.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(Color.White)
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Rounded.PlayArrow, contentDescription = null, tint = AccentRed, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Play", color = AccentRed, fontWeight = FontWeight.W700, style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

@Composable
private fun SongStationCard(item: ShelfItem, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(150.dp)
            .clickable(onClick = onClick),
    ) {
        Box(
            Modifier
                .size(150.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            AsyncImage(
                model = item.thumbnailUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f)))),
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(8.dp),
            ) {
                Icon(Icons.Rounded.Radio, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("STATION", color = Color.White, style = MaterialTheme.typography.labelSmall)
            }
        }
        Text(
            text = "${item.title} Station",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onBackground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp),
        )
        Text(
            text = item.subtitle,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun RadioSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(start = PAGE_GUTTER, end = PAGE_GUTTER, top = 22.dp, bottom = 10.dp),
    )
}

@Composable
private fun RadioHint(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = PAGE_GUTTER, vertical = 16.dp),
    )
}
