<?php
/**
 * 記事（本文＋右に「同じカテゴリの記事」。スマホでは下）
 */
get_header();

while ( have_posts() ) :
	the_post();
	$cat     = sk_blog_primary_category();
	$related = array();
	if ( $cat ) {
		$related = get_posts(
			array(
				'category__in'        => array( $cat->term_id ),
				'post__not_in'        => array( get_the_ID() ),
				'posts_per_page'      => 5,
				'ignore_sticky_posts' => true,
			)
		);
	}
	?>
<main id="main">
	<div class="sp-section">
		<div class="sp-wrap">
			<article <?php post_class( 'help-article' ); ?>>
				<nav class="crumbs" aria-label="パンくず">
					<a href="<?php echo esc_url( home_url( '/' ) ); ?>">SK Blog</a>
					<?php if ( $cat ) : ?>
						<span aria-hidden="true">›</span>
						<a href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><?php echo esc_html( $cat->name ); ?></a>
					<?php endif; ?>
				</nav>

				<h1><?php the_title(); ?></h1>

				<div class="post-meta">
					<time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>"><?php echo esc_html( get_the_date( 'Y年n月j日' ) ); ?></time>
					<?php if ( get_the_modified_date( 'Ymd' ) !== get_the_date( 'Ymd' ) ) : ?>
						<span>更新 <?php echo esc_html( get_the_modified_date( 'Y年n月j日' ) ); ?></span>
					<?php endif; ?>
					<span>約 <?php echo esc_html( sk_blog_reading_minutes() ); ?> 分</span>
					<span><?php the_author(); ?></span>
				</div>

				<?php if ( has_post_thumbnail() ) : ?>
					<figure class="post-hero"><?php the_post_thumbnail( 'large' ); ?></figure>
				<?php endif; ?>

				<div class="help-body entry">
					<?php
					the_content();
					wp_link_pages( array( 'before' => '<nav class="pager pager--inline">', 'after' => '</nav>' ) );
					?>
				</div>

				<?php if ( has_tag() ) : ?>
					<div class="post-tags"><?php the_tags( '', '', '' ); ?></div>
				<?php endif; ?>

				<nav class="post-nav" aria-label="前後の記事">
					<?php
					$prev = get_previous_post();
					$next = get_next_post();
					if ( $prev ) :
						?>
						<a class="post-nav-link" href="<?php echo esc_url( get_permalink( $prev ) ); ?>"><small>前の記事</small><strong><?php echo esc_html( get_the_title( $prev ) ); ?></strong></a>
					<?php endif; ?>
					<?php if ( $next ) : ?>
						<a class="post-nav-link post-nav-link--next" href="<?php echo esc_url( get_permalink( $next ) ); ?>"><small>次の記事</small><strong><?php echo esc_html( get_the_title( $next ) ); ?></strong></a>
					<?php endif; ?>
				</nav>

				<?php if ( comments_open() || get_comments_number() ) : ?>
					<?php comments_template(); ?>
				<?php endif; ?>

				<?php if ( $related ) : ?>
					<aside class="help-related">
						<h2><?php echo esc_html( $cat->name ); ?> の記事</h2>
						<ul>
							<?php foreach ( $related as $p ) : ?>
								<li><a href="<?php echo esc_url( get_permalink( $p ) ); ?>"><?php echo esc_html( get_the_title( $p ) ); ?></a></li>
							<?php endforeach; ?>
						</ul>
					</aside>
				<?php endif; ?>
			</article>
		</div>
	</div>
</main>
	<?php
endwhile;

get_footer();
