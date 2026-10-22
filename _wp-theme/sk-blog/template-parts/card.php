<?php
/**
 * 記事のカード（一覧用）
 */
$cat = sk_blog_primary_category();
?>
<a <?php post_class( 'help-card post-card' ); ?> href="<?php the_permalink(); ?>">
	<?php if ( has_post_thumbnail() ) : ?>
		<div class="post-card-thumb"><?php the_post_thumbnail( 'sk-card', array( 'loading' => 'lazy', 'alt' => '' ) ); ?></div>
	<?php endif; ?>
	<div class="post-card-meta">
		<?php sk_blog_cat_chip( $cat ); ?>
		<time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>"><?php echo esc_html( get_the_date( 'Y.m.d' ) ); ?></time>
	</div>
	<h2><?php the_title(); ?></h2>
	<p><?php echo esc_html( wp_strip_all_tags( get_the_excerpt() ) ); ?></p>
</a>
