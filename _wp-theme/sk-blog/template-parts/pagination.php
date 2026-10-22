<?php
/**
 * ページ送り
 */
$links = paginate_links(
	array(
		'mid_size'  => 1,
		'prev_text' => '‹<span class="screen-reader-text">前へ</span>',
		'next_text' => '<span class="screen-reader-text">次へ</span>›',
		'type'      => 'list',
	)
);
if ( $links ) {
	echo '<nav class="pager" aria-label="ページ送り">' . $links . '</nav>'; // phpcs:ignore WordPress.Security.EscapeOutput
}
