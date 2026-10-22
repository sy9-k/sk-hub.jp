<?php
/**
 * 一覧（ブログのトップ・カテゴリー・タグ・日付・検索のすべてをここで受ける）
 */
get_header();

$is_front   = is_home() && ! is_paged();
$kicker     = get_theme_mod( 'sk_blog_kicker', 'SK Blog' );
$lead       = get_theme_mod( 'sk_blog_lead', '' );
$categories = $is_front ? get_categories( array( 'orderby' => 'count', 'order' => 'DESC', 'number' => 8, 'hide_empty' => true ) ) : array();

if ( is_home() ) {
	$title = $is_front ? 'SK Blog' : get_bloginfo( 'name' );
	$sub   = $lead ? $lead : get_bloginfo( 'description' );
} elseif ( is_search() ) {
	$kicker = '検索';
	$title  = '「' . get_search_query() . '」の検索結果';
	$sub    = sprintf( '%d 件の記事が見つかりました。', (int) $wp_query->found_posts );
} elseif ( is_archive() ) {
	$kicker = is_category() ? 'カテゴリー' : ( is_tag() ? 'タグ' : 'アーカイブ' );
	$title  = get_the_archive_title();
	$title  = preg_replace( '/^[^:：]+[:：]\s*/u', '', $title );
	$sub    = wp_strip_all_tags( get_the_archive_description() );
} else {
	$kicker = '';
	$title  = get_bloginfo( 'name' );
	$sub    = '';
}
?>
<main id="main">
	<section class="sp-hero<?php echo $is_front ? '' : ' sp-hero--compact'; ?>">
		<div class="sp-wrap">
			<?php if ( $kicker ) : ?><p class="sp-hero-kicker"><?php echo esc_html( $kicker ); ?></p><?php endif; ?>
			<h1><?php echo esc_html( $title ); ?></h1>
			<?php if ( $sub ) : ?><p class="sp-hero-lead"><?php echo esc_html( $sub ); ?></p><?php endif; ?>
			<?php get_search_form(); ?>
			<?php if ( $categories ) : ?>
				<div class="sp-topics" aria-label="カテゴリーから探す">
					<?php foreach ( $categories as $cat ) : ?>
						<a class="sp-topic" href="<?php echo esc_url( get_category_link( $cat ) ); ?>">
							<span class="sp-topic-dot"></span>
							<strong><?php echo esc_html( $cat->name ); ?></strong>
							<small><?php echo esc_html( number_format_i18n( $cat->count ) ); ?> 件</small>
						</a>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>
		</div>
	</section>

	<section class="sp-section">
		<div class="sp-wrap">
			<?php if ( have_posts() ) : ?>
				<div class="help-list post-list">
					<?php
					while ( have_posts() ) :
						the_post();
						get_template_part( 'template-parts/card' );
					endwhile;
					?>
				</div>
				<?php get_template_part( 'template-parts/pagination' ); ?>
			<?php else : ?>
				<div class="empty">
					<p>記事が見つかりませんでした。</p>
					<p><a class="btn btn-tonal" href="<?php echo esc_url( home_url( '/' ) ); ?>">トップへ戻る</a></p>
				</div>
			<?php endif; ?>
		</div>
	</section>
</main>
<?php
get_footer();
